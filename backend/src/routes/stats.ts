/**
 * Dashboard stats endpoints — single source of truth.
 *
 *   GET /api/stats?unitup=51101             → 4 headline numbers
 *   GET /api/stats/per-ulp                  → per-ULP aggregate for the grid
 *   GET /api/stats/recent-anomalies         → one row per anomalous IDPEL
 *
 * ALL three pull anomaly data from the same shared helper
 * `getAnomalyResultsFromML()`, which calls POST /api/detect (RandomForest)
 * for every unique IDPEL in consumption_data. The result is cached in a
 * 60-second promise-cache so:
 *   - Concurrent fetches (dashboard fires all 3 endpoints in parallel) share
 *     ONE underlying ML fan-out — no triple cost.
 *   - Subsequent dashboard refreshes within 60s reuse the same result.
 *
 * total_idpel, total_files, last_upload, and file_count are still computed
 * from consumption_data / upload_logs directly — they're not anomaly counts.
 */

import { Router } from 'express'
import axios from 'axios'
import { getSupabaseService } from '../config/database'
import { logger } from '../utils/logger'
import { callMLWithRetry } from '../utils/mlClient'

const ML_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000'
const router = Router()

// ── ULP code → name (mirror of frontend lib/ulpConfig) ──────────────────────
const ULP_NAME: Record<string, string> = {
    '51101': 'ULP Indrapura',
    '51102': 'ULP Ploso',
    '51103': 'ULP Tandes',
    '51104': 'ULP Perak',
    '51105': 'ULP Kenjeran',
    '51106': 'ULP Embong Wungu',
}

const ID_MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function formatTimestampID(iso: string | null): string {
    if (!iso) return '—'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = ID_MONTH_SHORT[d.getMonth() + 1] ?? ''
    const yyyy = d.getFullYear()
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd} ${mm} ${yyyy} ${hh}:${mi}`
}

const num = (v: number | string | null | undefined): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '.'))
    return Number.isFinite(n) ? n : null
}

// ── Types ───────────────────────────────────────────────────────────────────
interface ConsumptionLite { customer_id: string | null; unitup: string | null; upload_id: string | null }
interface BillingRow { billing_period: string | null; kwh: number | string | null; rptag: number | string | null }
interface CustomerDayaRow { customer_id: string | null; contract_power_va: number | string | null }
interface DetectResponse { idpel: string; is_anomaly: boolean; confidence: number }

interface MLAnomalyResult {
    idpel: string
    unitup: string
    is_anomaly: true
    confidence: number
    severity: 'critical' | 'medium'
}

// ════════════════════════════════════════════════════════════════════════════
// Shared helper — cached ML fan-out
// ════════════════════════════════════════════════════════════════════════════
type SupabaseClient = ReturnType<typeof getSupabaseService>

const CACHE_TTL_MS = 60_000   // 1 minute — short enough to feel fresh after uploads
interface CacheEntry {
    promise: Promise<MLAnomalyResult[]> | null
    expiresAt: number
}
const mlCache: CacheEntry = { promise: null, expiresAt: 0 }

/** Force a cache refresh on the next call (used after invalidation events). */
export function invalidateAnomalyCache(): void {
    mlCache.promise = null
    mlCache.expiresAt = 0
}

async function computeAnomalyResults(supabase: SupabaseClient): Promise<MLAnomalyResult[]> {
    // 1. Distinct (customer_id, unitup) pairs from consumption_data
    const { data: consRows, error: consErr } = await supabase
        .from('consumption_data')
        .select('customer_id, unitup')
        .limit(50000)

    if (consErr) {
        logger.warn(`[ml-helper] consumption_data error: ${consErr.message}`)
        return []
    }

    const seen = new Map<string, string>()   // idpel → unitup
    for (const r of (consRows ?? []) as ConsumptionLite[]) {
        const id = r.customer_id?.trim()
        if (!id || seen.has(id)) continue
        seen.set(id, (r.unitup ?? '').trim())
    }

    const idpels = Array.from(seen.keys())
    if (idpels.length === 0) return []

    // 2. Pre-fetch contract_power_va for all idpels in ONE roundtrip
    const { data: custData } = await supabase
        .from('customers')
        .select('customer_id, contract_power_va')
        .in('customer_id', idpels)

    const dayaByIdpel = new Map<string, number | null>()
    for (const c of ((custData ?? []) as CustomerDayaRow[])) {
        if (c.customer_id) dayaByIdpel.set(c.customer_id, num(c.contract_power_va))
    }

    // 3. Parallel /api/detect fan-out
    const checks = await Promise.allSettled(idpels.map(async (idpel): Promise<MLAnomalyResult | null> => {
        const { data: rows, error } = await supabase
            .from('consumption_data')
            .select('billing_period, kwh, rptag')
            .eq('customer_id', idpel)
            .order('recorded_at', { ascending: true })

        if (error || !rows || rows.length < 3) return null

        // Dedupe by billing_period (multi-file safety) — keeps latest.
        const byPeriod = new Map<string, BillingRow>()
        for (const r of rows as BillingRow[]) {
            const p = String(r.billing_period ?? '').trim()
            if (!p) continue
            byPeriod.set(p, r)
        }
        const records = Array.from(byPeriod.values()).map((r) => ({
            blth_rek: String(r.billing_period ?? ''),
            pemkwh: num(r.kwh) ?? 0,
            rptag: num(r.rptag),
            daya: dayaByIdpel.get(idpel) ?? null,
        }))
        if (records.length < 3) return null

        try {
            // Use the retry-aware helper so a Render cold start doesn't
            // flatten the whole fan-out — each idpel survives 3 attempts
            // independently before being marked as a fan-out failure.
            const detect = await callMLWithRetry<DetectResponse>(
                `${ML_URL}/api/detect`,
                { idpel, records }
            )
            if (!detect.is_anomaly) return null
            const confidence = Number(detect.confidence)
            return {
                idpel,
                unitup: seen.get(idpel) ?? '',
                is_anomaly: true,
                confidence,
                severity: confidence >= 0.7 ? 'critical' : 'medium',
            }
        } catch (err: unknown) {
            const msg = axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)
            logger.warn(`[ml-helper] /api/detect failed for idpel=${idpel}: ${msg}`)
            return null
        }
    }))

    const results: MLAnomalyResult[] = []
    for (const c of checks) {
        if (c.status === 'fulfilled' && c.value !== null) results.push(c.value)
    }
    logger.info(`[ml-helper] ${results.length} anomalies from ${idpels.length} customers`)
    return results
}

/**
 * Returns the cached ML fan-out result, fetching fresh if expired.
 * Concurrent callers within the same TTL window await the SAME promise so
 * we never run the fan-out twice in parallel.
 */
async function getAnomalyResultsFromML(supabase: SupabaseClient): Promise<MLAnomalyResult[]> {
    const now = Date.now()
    if (mlCache.promise && mlCache.expiresAt > now) {
        return mlCache.promise
    }
    const p = computeAnomalyResults(supabase)
    mlCache.promise = p
    mlCache.expiresAt = now + CACHE_TTL_MS
    // If the fetch errors, invalidate so the next caller retries fresh.
    p.catch(() => invalidateAnomalyCache())
    return p
}

// ════════════════════════════════════════════════════════════════════════════
// GET /api/stats  — 4 headline numbers, optional ?unitup filter
// ════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
    try {
        const supabase = getSupabaseService()
        const unitup = (req.query.unitup as string | undefined)?.trim() || null

        const [{ data: consRows }, { data: lastRow }, anomalies] = await Promise.all([
            supabase.from('consumption_data').select('customer_id, unitup, upload_id').limit(50000),
            supabase.from('upload_logs').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle(),
            getAnomalyResultsFromML(supabase),
        ])

        const cons = ((consRows ?? []) as ConsumptionLite[]).filter(
            (r) => !unitup || (r.unitup ?? '').trim() === unitup
        )

        const distinctCustomers = new Set<string>()
        const distinctUploads = new Set<string>()
        for (const r of cons) {
            if (r.customer_id) distinctCustomers.add(r.customer_id)
            if (r.upload_id) distinctUploads.add(r.upload_id)
        }

        const total_anomalies = anomalies.filter((a) => !unitup || a.unitup === unitup).length

        const lastUploadIso = (lastRow as { created_at: string | null } | null)?.created_at ?? null

        const payload = {
            total_files: distinctUploads.size,
            total_idpel: distinctCustomers.size,
            total_anomalies,
            last_upload: formatTimestampID(lastUploadIso),
        }

        logger.info(
            `[stats] unitup=${unitup ?? 'ALL'} files=${payload.total_files} ` +
            `idpel=${payload.total_idpel} anomalies=${payload.total_anomalies}`
        )
        res.status(200).json(payload)
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.error(`[stats] error, returning zeros: ${msg}`)
        res.status(200).json({
            total_files: 0,
            total_idpel: 0,
            total_anomalies: 0,
            last_upload: '—',
        })
    }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/stats/per-ulp
// File / pelanggan counts come from consumption_data; anomaly counts come
// from the SAME ML helper that powers /recent-anomalies.
// ════════════════════════════════════════════════════════════════════════════
router.get('/per-ulp', async (_req, res) => {
    try {
        const supabase = getSupabaseService()

        const [{ data: consRows }, anomalies] = await Promise.all([
            supabase.from('consumption_data').select('customer_id, unitup, upload_id').limit(50000),
            getAnomalyResultsFromML(supabase),
        ])

        interface Bucket {
            unitup: string
            ulp_name: string
            anomaly_count: number
            total_idpel: number
            file_count: number
        }
        const buckets = new Map<string, Bucket>()
        const getBucket = (code: string): Bucket => {
            let b = buckets.get(code)
            if (!b) {
                b = {
                    unitup: code,
                    ulp_name: ULP_NAME[code] ?? `ULP ${code}`,
                    anomaly_count: 0,
                    total_idpel: 0,
                    file_count: 0,
                }
                buckets.set(code, b)
            }
            return b
        }

        const customersByUlp = new Map<string, Set<string>>()
        const uploadsByUlp = new Map<string, Set<string>>()
        for (const r of (consRows ?? []) as ConsumptionLite[]) {
            const code = (r.unitup ?? '').trim()
            if (!code) continue
            getBucket(code)
            if (r.customer_id) {
                if (!customersByUlp.has(code)) customersByUlp.set(code, new Set())
                customersByUlp.get(code)!.add(r.customer_id)
            }
            if (r.upload_id) {
                if (!uploadsByUlp.has(code)) uploadsByUlp.set(code, new Set())
                uploadsByUlp.get(code)!.add(r.upload_id)
            }
        }
        for (const [code, set] of customersByUlp) getBucket(code).total_idpel = set.size
        for (const [code, set] of uploadsByUlp) getBucket(code).file_count = set.size

        // Anomaly counts from the shared ML helper
        for (const a of anomalies) {
            if (!a.unitup) continue
            getBucket(a.unitup).anomaly_count += 1
        }

        const out = Array.from(buckets.values()).sort((a, b) => a.unitup.localeCompare(b.unitup))
        logger.info(`[stats/per-ulp] Returning ${out.length} ULP rows`)
        res.status(200).json(out)
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.error(`[stats/per-ulp] error, returning []: ${msg}`)
        res.status(200).json([])
    }
})

// ════════════════════════════════════════════════════════════════════════════
// GET /api/stats/recent-anomalies
// Returns the shared ML result directly, sorted critical-first.
// ════════════════════════════════════════════════════════════════════════════
router.get('/recent-anomalies', async (_req, res) => {
    try {
        const supabase = getSupabaseService()
        const anomalies = await getAnomalyResultsFromML(supabase)

        const sorted = [...anomalies].sort((a, b) => {
            if (a.severity === 'critical' && b.severity !== 'critical') return -1
            if (a.severity !== 'critical' && b.severity === 'critical') return 1
            return a.idpel.localeCompare(b.idpel)
        })

        // Frontend only needs idpel/unitup/is_anomaly/severity.
        const payload = sorted.map((a) => ({
            idpel: a.idpel,
            unitup: a.unitup,
            is_anomaly: a.is_anomaly,
            severity: a.severity,
        }))

        logger.info(`[stats/recent-anomalies] Returning ${payload.length} anomalies`)
        res.status(200).json(payload)
    } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error)
        logger.error(`[stats/recent-anomalies] error, returning []: ${msg}`)
        res.status(200).json([])
    }
})

export default router
