/**
 * ML pipeline client with timeout + cold-start retry.
 *
 * Render's free tier puts the FastAPI service to sleep after ~15 minutes
 * idle. The first request after sleep takes ~30 seconds to wake the
 * container — that's the "cold start". We handle this by:
 *   - long axios timeout (60s) per attempt
 *   - exponential-ish backoff retries (15s, 30s, 45s)
 *
 * The legacy `predictAnomaly` / `predictForecast` helpers are kept as no-ops
 * so uploadWorker.ts doesn't need to be touched — current architecture
 * computes ML on-demand via /api/anomaly-analysis and /api/stats.
 */

import axios, { type AxiosResponse } from 'axios'
import { logger } from './logger'

const DEFAULT_TIMEOUT = 60_000   // 60s — survives one Render cold start
const DEFAULT_RETRIES = 3

/**
 * POST a payload to an ML endpoint with cold-start-aware retries.
 *
 *   const result = await callMLWithRetry<DetectResponse>(
 *     `${ML_URL}/api/detect`,
 *     { idpel, records }
 *   )
 *
 * Throws on final failure (caller should try/catch). Backs off 15s × attempt
 * between retries so we don't hammer a cold container.
 */
export async function callMLWithRetry<T = unknown>(
  url: string,
  payload: object,
  maxRetries: number = DEFAULT_RETRIES,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res: AxiosResponse<T> = await axios.post<T>(url, payload, {
        timeout: DEFAULT_TIMEOUT,
      })
      if (attempt > 1) {
        logger.info(`[ML] succeeded on attempt ${attempt}/${maxRetries}`)
      }
      return res.data
    } catch (err: unknown) {
      lastErr = err
      const isLast = attempt === maxRetries
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const msg = axios.isAxiosError(err) ? (err.response?.data?.detail ?? err.message) : String(err)

      // Stop early on 4xx (client error) — retrying won't help.
      if (typeof status === 'number' && status >= 400 && status < 500) {
        logger.warn(`[ML] ${status} from ${url} — not retrying: ${msg}`)
        throw err
      }

      if (isLast) {
        logger.warn(`[ML] all ${maxRetries} attempts failed: ${msg}`)
        throw err
      }

      const waitMs = attempt * 15_000   // 15s, 30s, 45s
      logger.warn(`[ML] attempt ${attempt}/${maxRetries} failed (${msg}); retrying in ${waitMs / 1000}s...`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  // Unreachable — but TS needs a return.
  throw lastErr
}

// ── Legacy worker-side helpers — kept as no-ops ─────────────────────────────
// The worker (uploadWorker.ts) imports these. With the on-demand architecture
// ML is invoked at request time, not at upload time, so these stay as a
// silent no-op rather than triggering removal of worker imports.

export interface AnomalyResponse {
  predictions: number[]
  anomaly_scores: number[]
  count: number
}

export interface ForecastPoint {
  date: string
  predicted_kwh: number
}

export interface ForecastResponse {
  forecasts: Record<string, ForecastPoint[]>
  count: number
  requested: number
  served: number
  skipped: string[]
}

export interface ForecastSeriesInput {
  idpel: string
  values: number[]
  dates?: string[]
}

let warned = false
function warnOnce(): void {
  if (warned) return
  warned = true
  logger.info(
    '[ML] worker-side inference disabled — analysis runs on-demand via /api/anomaly-analysis and /api/stats/recent-anomalies'
  )
}

export const predictAnomaly = async (
  _rows: Record<string, number>[]
): Promise<AnomalyResponse | null> => {
  warnOnce()
  return null
}

export const predictForecast = async (
  _idpels: string[],
  _steps?: number,
  _lastWindow?: ForecastSeriesInput[],
): Promise<ForecastResponse | null> => {
  warnOnce()
  return null
}
