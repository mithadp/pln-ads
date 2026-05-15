/**
 * GET /api/forecast?idpel=...&horizon=3|6|9
 *
 * Pulls the customer's history from consumption_data, forwards it to FastAPI's
 * Prophet pipeline (forecasting_model_ts.pkl config), merges actual + predicted
 * into chartData, and returns model metrics for the accuracy card.
 *
 * No rule-based predictions here — every predicted_kwh comes from Prophet,
 * with metrics tied to the .pkl's training run (MAE 0.91 / MAPE 0.44 / R² 0.9876).
 */

import { Router, type Request, type Response, type NextFunction } from 'express'
import axios from 'axios'
import { getSupabaseService } from '../config/database'
import { logger } from '../utils/logger'

const router = Router()

interface ConsumptionRow {
  blth_rek?: string | null
  billing_period?: string | null
  kwh: number | string | null
  unitup: string | null
  recorded_at?: string | null
}

interface MLForecastPrediction { date: string; predicted_kwh: number }
interface MLForecastMetrics { model: string; mae: number; mape: number; r2: number }
interface MLForecastResponse {
  idpel: string
  horizon: number
  predictions: MLForecastPrediction[]
  metrics: MLForecastMetrics
}

const ID_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function formatLabel(blth: string): string {
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

/** Sort key derived from "MM-YYYY". */
function periodSortKey(s: string): number {
  const m = s.match(/^(\d{1,2})-(\d{4})$/)
  if (!m) return 0
  return parseInt(m[2], 10) * 12 + parseInt(m[1], 10)
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const idpel = req.query.idpel
    const horizonRaw = parseInt(String(req.query.horizon ?? '3'), 10)
    const horizon = Math.min(9, Math.max(3, Number.isFinite(horizonRaw) ? horizonRaw : 3))

    if (!idpel || typeof idpel !== 'string') {
      res.status(400).json({ message: 'Parameter idpel diperlukan' })
      return
    }

    const supabase = getSupabaseService()

    // 1. History from consumption_data ──────────────────────────────────────
    const { data, error } = await supabase
      .from('consumption_data')
      .select('billing_period, kwh, unitup, recorded_at')
      .eq('customer_id', idpel)
      .order('recorded_at', { ascending: true })

    if (error) {
      throw new Error(error.message)
    }
    const rows = (data ?? []) as ConsumptionRow[]
    if (rows.length === 0) {
      res.status(404).json({
        message: `IDPEL ${idpel} tidak ditemukan. Upload file .xls terlebih dahulu.`,
      })
      return
    }

    // 2. Dedupe by billing period, build history array ──────────────────────
    const byPeriod = new Map<string, number>()
    for (const r of rows) {
      const key = String(r.blth_rek ?? r.billing_period ?? '').trim()
      if (!key) continue
      byPeriod.set(key, toNumber(r.kwh))
    }
    const unitup = String(rows[0].unitup ?? '')
    const history = Array.from(byPeriod.entries())
      .map(([date, actual]) => ({ date, actual }))
      .sort((a, b) => periodSortKey(a.date) - periodSortKey(b.date))

    if (history.length < 12) {
      res.status(400).json({
        message: `Prophet butuh minimal 12 bulan histori (IDPEL ini hanya punya ${history.length} bulan).`,
      })
      return
    }

    // 3. POST to FastAPI /api/forecast ──────────────────────────────────────
    const ML_URL = process.env.ML_SERVICE_URL ?? 'http://localhost:8000'
    const mlRes = await axios.post<MLForecastResponse>(
      `${ML_URL}/api/forecast`,
      { idpel, history, horizon },
      { timeout: 60000 }
    )
    const ml = mlRes.data

    // 4. Merge actual + predicted into chartData ────────────────────────────
    const actualMap = new Map(history.map((h) => [h.date, h.actual]))
    const predictMap = new Map(ml.predictions.map((p) => [p.date, p.predicted_kwh]))
    const allDates = Array.from(new Set([...actualMap.keys(), ...predictMap.keys()]))
      .sort((a, b) => periodSortKey(a) - periodSortKey(b))

    const chartData = allDates.map((date) => ({
      date,                          // raw "MM-YYYY"
      label: formatLabel(date),      // human "Jun 2026"
      actual: actualMap.has(date) ? actualMap.get(date) ?? null : null,
      predicted: predictMap.has(date) ? predictMap.get(date) ?? null : null,
    }))

    // 5. Aggregate stats ────────────────────────────────────────────────────
    const actuals = history.map((h) => h.actual)
    const preds = ml.predictions.map((p) => p.predicted_kwh)
    const avg = (arr: number[]): number | null =>
      arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null

    const payload = {
      idpel,
      unitup,
      horizon,
      chartData,
      avgActual: avg(actuals),
      avgPredicted: avg(preds),
      modelMetrics: ml.metrics,
    }

    logger.info(
      `[forecast] idpel=${idpel} horizon=${horizon} → ${history.length} actuals + ${ml.predictions.length} predicted (${ml.metrics.model})`
    )
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
