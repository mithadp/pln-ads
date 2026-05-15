/**
 * GET /api/anomaly-analysis?idpel=...
 *
 * Pure pass-through to the RandomForest fraud detector. No rule-based
 * deviation logic, no rolling means, no per-month is_anomaly flags.
 * The ONLY intelligence comes from fraud_detection_model.pkl via FastAPI.
 *
 * The `monthly` array we return is just the customer's raw billing history
 * (periode + actual kWh) — for display context only. Nothing in this route
 * decides whether a month is "anomalous".
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import axios from 'axios'
import { getSupabaseService } from '../config/database'
import { logger } from '../utils/logger'
import { callMLWithRetry } from '../utils/mlClient'

const router = Router()

interface ConsumptionRow {
  blth_rek?: string | null
  billing_period?: string | null
  kwh: number | string | null
  rptag: number | string | null
  unitup: string | null
  customer_id: string | null
  recorded_at?: string | null
}

interface CustomerInfoRow {
  tariff: string | null
  contract_power_va: number | string | null
  region: string | null
}

interface MLDetectResponse {
  idpel: string
  is_anomaly: boolean
  confidence: number   // 0..1
}

const ID_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function formatPeriod(blth: string): string {
  if (!blth) return ''
  const m = blth.match(/^(\d{1,2})-(\d{4})$/)
  if (!m) return blth
  return `${ID_MONTHS[parseInt(m[1], 10)] ?? m[1]} ${m[2]}`
}

function toNumber(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '.'))
  return Number.isFinite(n) ? n : 0
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idpel = req.query.idpel
    if (!idpel || typeof idpel !== 'string') {
      res.status(400).json({ message: 'Parameter idpel diperlukan' })
      return
    }

    const supabase = getSupabaseService()

    // 1. History from consumption_data ──────────────────────────────────────
    const { data: consData, error: consErr } = await supabase
      .from('consumption_data')
      .select('billing_period, kwh, rptag, unitup, customer_id, recorded_at')
      .eq('customer_id', idpel)
      .order('recorded_at', { ascending: true })

    if (consErr) throw new Error(consErr.message)
    const rawRows = (consData ?? []) as ConsumptionRow[]
    if (rawRows.length === 0) {
      res.status(404).json({
        message: `IDPEL ${idpel} tidak ditemukan. Upload file .xls pelanggan ini terlebih dahulu.`,
      })
      return
    }

    // 2. Customer metadata ──────────────────────────────────────────────────
    const { data: custData } = await supabase
      .from('customers')
      .select('tariff, contract_power_va, region')
      .eq('customer_id', idpel)
      .limit(1)
    const customer = ((custData ?? []) as CustomerInfoRow[])[0]
    const dayaFromCustomer = customer ? toNumber(customer.contract_power_va) : null

    // 3. Dedupe by billing period (multi-file safety) ───────────────────────
    const byPeriod = new Map<string, ConsumptionRow>()
    for (const r of rawRows) {
      const period = String(r.blth_rek ?? r.billing_period ?? '').trim()
      if (!period) continue
      byPeriod.set(period, r)
    }
    const rows = Array.from(byPeriod.values())

    const records = rows.map((r) => ({
      blth_rek: String(r.blth_rek ?? r.billing_period ?? ''),
      pemkwh: toNumber(r.kwh),
      rptag: toNumber(r.rptag),
      daya: dayaFromCustomer ?? null,
    }))

    if (records.length < 3) {
      res.status(400).json({
        message: `Minimal 3 bulan data diperlukan untuk analisis (IDPEL ini hanya punya ${records.length} bulan).`,
      })
      return
    }

    // 4. Call ML pipeline — the only intelligence in this flow ──────────────
    //    `callMLWithRetry` survives a Render cold start: 3 attempts, 15/30/45s
    //    backoff, 60s axios timeout each. 4xx errors stop early.
    const ML_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000'
    const fraudData = await callMLWithRetry<MLDetectResponse>(
      `${ML_URL}/api/detect`,
      { idpel, records }
    )

    // Single source of truth — coerced once, reused everywhere in this
    // response. Nothing downstream re-derives is_anomaly or confidence.
    const mlIsAnomaly = Boolean(fraudData.is_anomaly)
    const mlConfidence = Number(fraudData.confidence)
    const mlRiskScore = Math.round(mlConfidence * 100)

    logger.info(
      `[detect] idpel=${idpel} confidence=${fraudData.confidence} is_anomaly=${fraudData.is_anomaly}`
    )

    // 5. Build response ─────────────────────────────────────────────────────
    const unitup = String(rows[0].unitup ?? '')

    type Sev = 'critical' | 'medium'
    const signals: { name: string; severity: Sev }[] = mlIsAnomaly
      ? [{
          name: `Terdeteksi oleh model RandomForest — confidence ${mlRiskScore}%`,
          severity: mlConfidence >= 0.7 ? 'critical' : 'medium',
        }]
      : []

    const monthly = rows.map((r) => ({
      periode: formatPeriod(String(r.blth_rek ?? r.billing_period ?? '')),
      actual: toNumber(r.kwh),
    }))

    const payload = {
      idpel,
      unitup,
      tarif: customer ? String(customer.tariff ?? '') : '',
      daya: dayaFromCustomer ?? 0,
      is_anomaly: mlIsAnomaly,
      confidence: mlConfidence,
      risk_score: mlRiskScore,
      model_used: 'RandomForest (fraud_detection_model.pkl)',
      signals,
      monthly,
      summary: {
        total_months: rows.length,
        is_anomaly: mlIsAnomaly,
        confidence_pct: mlRiskScore,
      },
    }

    res.status(200).json(payload)
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNREFUSED') {
        res.status(503).json({
          message: 'ML Pipeline tidak berjalan. Jalankan: cd ml_pipeline && uvicorn main:app --port 8000',
        })
        return
      }
      const detail = err.response?.data?.detail ?? err.response?.data?.message ?? err.message
      res.status(err.response?.status ?? 502).json({
        message: `ML pipeline error: ${detail}`,
      })
      return
    }
    next(err)
  }
})

export default router
