import { Worker, Job } from 'bullmq'
import fs from 'fs'
import * as cheerio from 'cheerio'
import { getRedis } from '../config/redis'
import { getSupabaseService } from '../config/database'
import { UPLOAD_QUEUE_NAME, ANOMALY_THRESHOLDS, ANOMALY_SEVERITY } from '../constants/config'
import { logger } from '../utils/logger'
import { predictAnomaly, predictForecast } from '../utils/mlClient'

// Columns whose presence indicates the upload carries consumption data
// suitable for ML inference. Matched case-insensitively against parsed headers.
// PEMKWH is the real column name in PLN billing exports — keep it first so
// the worker recognizes the canonical PLN schema before falling back to
// generic aliases.
const KWH_COLUMNS = ['PEMKWH', 'KWH', 'PEMAKAIAN', 'PEMAKAIAN_KWH', 'STAND_AKHIR', 'STAND_AWAL']

const deriveSeverity = (score: number): string => {
  // IsolationForest score_samples returns higher = more normal, lower = more anomalous.
  const magnitude = Math.abs(score)
  if (magnitude >= ANOMALY_THRESHOLDS.HIGH) return ANOMALY_SEVERITY.HIGH.toLowerCase()
  if (magnitude >= ANOMALY_THRESHOLDS.MEDIUM) return ANOMALY_SEVERITY.MEDIUM.toLowerCase()
  return ANOMALY_SEVERITY.LOW.toLowerCase()
}

// unitup is stored as the raw PLN ULP code (e.g. "51101"). Frontend dropdown
// translates the code to a human label.
const unitupCode = (raw?: string): string | null => {
  const s = (raw ?? '').trim()
  return s.length > 0 ? s : null
}

// PLN exports use multiple date formats: ISO (2024-05-01), YYYYMMDD (20240501),
// DD/MM/YYYY, DD-MM-YYYY. Returns null for anything unparseable so callers can
// fall back gracefully — never throws (which is what crashed the worker on
// `new Date('30/04/2024').toISOString()`).
const toIso = (v: any): string | null => {
  if (v == null || v === '') return null
  const s = String(v).trim()
  let candidate: Date | null = null

  // ISO: 2024-05-01 or 2024-05-01T...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    candidate = new Date(s)
  }
  // YYYYMMDD: 20240501
  else if (/^\d{8}$/.test(s)) {
    candidate = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`)
  }
  // DD/MM/YYYY or DD-MM-YYYY (Indonesian/PLN format)
  else {
    const m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
    if (m) {
      const day = m[1].padStart(2, '0')
      const mon = m[2].padStart(2, '0')
      candidate = new Date(`${m[3]}-${mon}-${day}T00:00:00Z`)
    } else {
      // Last resort: let JS try (catches things like "May 1 2024")
      candidate = new Date(s)
    }
  }

  return candidate && !Number.isNaN(candidate.getTime()) ? candidate.toISOString() : null
}

export const startUploadWorker = () => {
  const worker = new Worker(
    UPLOAD_QUEUE_NAME,
    async (job: Job) => {
      const { upload_id, user_id, file_path } = job.data

      if (!upload_id || !file_path) {
        throw new Error('Missing upload_id or file_path in job payload')
      }

      logger.info(`👷 [Worker] Picked up job ${job.id} for upload ${upload_id} (user: ${user_id ?? 'unknown'})`)

      const supabase = getSupabaseService()

      try {
        // 2. Read and parse the HTML file disguised as .xls
        if (!fs.existsSync(file_path)) {
          throw new Error(`File not found at path: ${file_path}`)
        }

        const htmlContent = fs.readFileSync(file_path, 'utf-8')
        
        logger.info(`👷 [Worker] Parsing HTML table from ${file_path}`)
        const $ = cheerio.load(htmlContent)
        
        const table = $('table')
        if (table.length === 0) {
          throw new Error('No <table> found in the uploaded file')
        }

        const rows = table.find('TR, tr')

        // Extract headers from tH/th elements
        const headers: string[] = []
        table.find('tH, th').each((_, el) => {
          const headerText = $(el).text().replace(/\u00a0/g, ' ').trim()
          headers.push(headerText.toUpperCase())
        })

        const parsedRows: Record<string, string>[] = []

        rows.each((_, row) => {
          const tds = $(row).find('tD, td')
          if (tds.length > 0) {
            const rowData: Record<string, string> = {}
            tds.each((j, td) => {
              const colName = headers[j] || `COL_${j}`
              let cellText = $(td).text().trim()
              cellText = cellText.replace(/^'+|'+$/g, '')
              rowData[colName] = cellText
            })
            parsedRows.push(rowData)
          }
        })

        const groupedCustomers = new Map<string, Record<string, string>>()
        parsedRows.forEach((row) => {
          const idpel = row['IDPEL']
          if (!idpel) return
          if (!groupedCustomers.has(idpel)) {
            groupedCustomers.set(idpel, row)
          }
        })

        const customers = Array.from(groupedCustomers.values()).map((row) => {
          const dayaValue = row['DAYA'] || ''
          const contract_power_va = Number.isNaN(Number(dayaValue))
            ? null
            : parseInt(dayaValue, 10)

          return {
            upload_id,
            customer_id: row['IDPEL'],
            tariff: row['TRF'] || null,
            contract_power_va,
            region: row['UNITUP'] || null,
            full_name: `Pelanggan ${row['IDPEL']}`,
            meter_type: 'UNKNOWN',
          }
        })

        if (customers.length > 0) {
          await (supabase as any)
            .from('customers')
            .upsert(customers, { onConflict: ['customer_id'] })
        }

        // ── Persist raw consumption rows ──────────────────────────────────────
        // Insert every parsed row (one per customer×period) into consumption_data
        // so /api/stats, /api/forecast and the anomaly history have something
        // to query. Mapping mirrors the PLN Excel column names exactly.
        const consumptionInserts: any[] = []
        for (const row of parsedRows) {
          const customerId = row['IDPEL']
          if (!customerId) continue

          const num = (v: any): number | null => {
            if (v == null || v === '') return null
            const n = Number(String(v).replace(/,/g, '.'))
            return Number.isFinite(n) ? n : null
          }

          // BLTH REK is the raw billing period as exported by PLN ("YYYYMM"
          // most often, sometimes "MM-YYYY"). We store it verbatim in
          // `billing_period`. `recorded_at` derives a real ISO date from it
          // so time-based queries (stats, forecast) work.
          const blth = String(row['BLTH REK'] ?? row['BLTHREK'] ?? '').trim()
          const blthMatch = blth.match(/^(\d{4})(\d{2})/)
          let recordedAt: string
          if (blthMatch) {
            recordedAt = `${blthMatch[1]}-${blthMatch[2]}-01T00:00:00Z`
          } else {
            recordedAt = toIso(row['TGLBAYAR']) ?? toIso(row['TANGGAL']) ?? new Date().toISOString()
          }

          const pemkwhValue = num(row['PEMKWH'])
          // ONLY columns that actually exist in `consumption_data` per the
          // live schema (probed via /api/anomaly-analysis discovery):
          //   upload_id, customer_id, unitup, kwh, daya, rptag,
          //   billing_period, recorded_at, created_at
          // The richer schema (idpel/pemkwh/blth_rek/slalwbp/…) lives only
          // in `database_schema.sql` and was never applied to the DB. Until
          // that migration runs we keep inserts minimal so the worker stops
          // hitting "column not found" errors.
          consumptionInserts.push({
            upload_id,
            customer_id: customerId,
            unitup: unitupCode(row['UNITUP']),
            kwh: pemkwhValue,
            daya: num(row['DAYA']),
            rptag: num(row['RPTAG']),
            billing_period: blth || null,
            recorded_at: recordedAt,
          })
        }

        if (consumptionInserts.length > 0) {
          const { error: consumptionErr } = await (supabase as any)
            .from('consumption_data')
            .insert(consumptionInserts)

          if (consumptionErr) {
            logger.error(
              `[consumption_data] insert failed: ${consumptionErr.message} ` +
              `(code=${consumptionErr.code ?? '?'}, hint=${consumptionErr.hint ?? '-'}, details=${consumptionErr.details ?? '-'})`
            )
          } else {
            logger.info(`✅ consumption_data: inserted ${consumptionInserts.length} rows`)
          }
        }

        // ── ML Pipeline forwarding ────────────────────────────────────────────
        // Scan parsed rows for kWh-like numeric columns. If any are present,
        // forward to FastAPI (port 8000) and persist predictions to Supabase.
        // If none are present (e.g. customer master-data file), skip gracefully.
        const matchedKwhCol = headers.find((h) => KWH_COLUMNS.includes(h))
        let anomaliesInserted = 0
        let forecastsInserted = 0

        if (matchedKwhCol) {
          const numericRows: Record<string, number>[] = []
          const rowContext: {
            location: string
            unitup: string | null
            idpel: string | null
            blth_rek: string | null
            recorded_at: string
          }[] = []

          for (const row of parsedRows) {
            const kwhRaw = row[matchedKwhCol]
            const kwh = Number(String(kwhRaw).replace(/,/g, '.'))
            if (!Number.isFinite(kwh)) continue

            // Key the matched column under its lowercase name (e.g. 'pemkwh')
            // so it lines up with the trained model's feature_cols list.
            const featureRow: Record<string, number> = {
              [matchedKwhCol.toLowerCase()]: kwh,
            }
            // Pass through any other numeric columns (DAYA, RPTAG, RPBEBAN, etc.)
            // so the model has additional signal where available.
            for (const h of headers) {
              if (h === matchedKwhCol) continue
              const v = Number(String(row[h] ?? '').replace(/,/g, '.'))
              if (Number.isFinite(v)) featureRow[h.toLowerCase()] = v
            }
            // Derived features the model expects but aren't in the raw schema.
            // Compute the cheap ones; leave the rolling/historical ones at 0
            // (they require cross-row aggregation and per-customer history).
            if (featureRow.daya > 0) {
              featureRow.kwh_per_daya = kwh / featureRow.daya
            }
            if (featureRow.rptag != null && kwh > 0) {
              featureRow.tagihan_per_kwh = featureRow.rptag / kwh
            }
            const blth = row['BLTH REK'] ?? row['BLTHREK'] ?? ''
            // BLTH REK is like "YYYYMM" (e.g. "202504") — extract month.
            const monthMatch = String(blth).match(/^(\d{4})(\d{2})/)
            if (monthMatch) {
              const month = parseInt(monthMatch[2], 10)
              featureRow.month_sin = Math.sin((2 * Math.PI * month) / 12)
              featureRow.month_cos = Math.cos((2 * Math.PI * month) / 12)
            }
            featureRow.zero_usage = kwh === 0 ? 1 : 0
            numericRows.push(featureRow)
            // rowContext.recorded_at must already be ISO — it ends up in
            // anomalies.detected_at, and Supabase will reject DD/MM/YYYY etc.
            const blthRekRaw = String(row['BLTH REK'] ?? row['BLTHREK'] ?? '').trim()
            rowContext.push({
              location: row['UNITUP'] ?? row['LOCATION'] ?? 'Unknown',
              unitup: unitupCode(row['UNITUP']),
              idpel: String(row['IDPEL'] ?? '').trim() || null,
              blth_rek: blthRekRaw || null,
              recorded_at:
                toIso(row['TGLBAYAR']) ??
                toIso(row['TANGGAL']) ??
                toIso(row['DATE']) ??
                new Date().toISOString(),
            })
          }

          // Collect unique IDPELs in this upload + their unitup, for the
          // forecast call which is indexed by IDPEL (not row features).
          const idpelToUnitup = new Map<string, string | null>()
          for (const row of parsedRows) {
            const idpel = String(row['IDPEL'] ?? '').trim()
            if (idpel && !idpelToUnitup.has(idpel)) {
              idpelToUnitup.set(idpel, unitupCode(row['UNITUP']))
            }
          }
          const idpels = Array.from(idpelToUnitup.keys())

          logger.info(`[ML] forwarding ${numericRows.length} rows (kWh col: ${matchedKwhCol}) + ${idpels.length} IDPELs to FastAPI`)

          const [anomalyRes, forecastRes] = await Promise.all([
            predictAnomaly(numericRows),
            predictForecast(idpels),
          ])

          // Persist anomalies. The ML bundle is a KNeighborsClassifier (binary)
          // where 1 = anomaly, 0 = normal. For backward compat with IsolationForest
          // (-1 = anomaly), we treat any non-zero prediction as an anomaly.
          if (anomalyRes?.predictions?.length) {
            // Log the class distribution so it's easy to verify model behavior
            // against the file we just processed.
            const dist: Record<string, number> = {}
            for (const p of anomalyRes.predictions) {
              const k = String(p)
              dist[k] = (dist[k] ?? 0) + 1
            }
            logger.info(`[ML] anomaly prediction distribution: ${JSON.stringify(dist)}`)

            const anomalyInserts = anomalyRes.predictions
              .map((pred, i) => {
                if (pred === 0) return null
                const pemkwh = numericRows[i].pemkwh ?? numericRows[i].kwh ?? 0
                const score = anomalyRes.anomaly_scores[i] ?? 0
                const ctx = rowContext[i]
                return {
                  upload_id,
                  user_id: user_id ?? null,
                  // `location` kept for backward compat with any existing rows;
                  // new code (frontend filter pills, table badges) uses unitup.
                  location: ctx.location,
                  unitup: ctx.unitup,
                  idpel: ctx.idpel,
                  blth_rek: ctx.blth_rek,
                  detected_at: ctx.recorded_at,
                  actual_kwh: pemkwh,
                  expected_kwh: null,
                  deviation_pct: null,
                  severity: deriveSeverity(score),
                }
              })
              .filter(Boolean)

            if (anomalyInserts.length > 0) {
              const { error } = await (supabase as any).from('anomalies').insert(anomalyInserts)
              if (error) {
                logger.warn(`[ML] anomalies insert failed: ${error.message}`)
              } else {
                anomaliesInserted = anomalyInserts.length
              }
            }
          }

          // Persist forecasts. Each IDPEL → list of {date, predicted_kwh}.
          // Skip IDPELs the model didn't recognize (forecastRes.skipped).
          if (forecastRes?.forecasts && Object.keys(forecastRes.forecasts).length > 0) {
            const forecastInserts: any[] = []
            for (const [idpel, points] of Object.entries(forecastRes.forecasts)) {
              for (const p of points) {
                forecastInserts.push({
                  upload_id,
                  user_id: user_id ?? null,
                  // forecast_results.customer_id is NOT NULL on the live DB —
                  // failing to set it makes every insert violate the constraint.
                  customer_id: idpel,
                  unitup: idpelToUnitup.get(idpel) ?? null,
                  forecast_date: p.date,
                  predicted_kwh: p.predicted_kwh,
                  accuracy: null,
                })
              }
            }

            if (forecastInserts.length > 0) {
              const { error } = await (supabase as any).from('forecast_results').insert(forecastInserts)
              if (error) {
                logger.warn(
                  `[ML] forecast_results insert failed: ${error.message} ` +
                  `(code=${error.code ?? '?'}, hint=${error.hint ?? '-'}, details=${error.details ?? '-'})`
                )
              } else {
                forecastsInserted = forecastInserts.length
              }
            }
          }

          logger.info(`[ML] persisted — anomalies: ${anomaliesInserted}, forecasts: ${forecastsInserted}`)
        } else {
          logger.info('[ML] skipped: no consumption columns (KWH/PEMAKAIAN/STAND_*) in this upload')
        }

        await (supabase as any)
          .from('upload_logs')
          .update({
            status: 'completed',
            rows_total: parsedRows.length,
            rows_success: customers.length,
          })
          .eq('id', upload_id)

        logger.info(`👷 [Worker] Job ${job.id} completed! rows=${parsedRows.length}, customers=${customers.length}, anomalies=${anomaliesInserted}, forecasts=${forecastsInserted}`)

      } catch (error: any) {
        logger.error(`👷 [Worker] Job ${job.id} failed:`, error)
        
        // Update status to 'failed'
        await (supabase as any)
          .from('upload_logs')
          .update({ 
            status: 'failed',
            error_message: error.message || 'Unknown error during processing'
          })
          .eq('id', upload_id)
          
        throw error // Rethrow so BullMQ registers the failure
      }
    },
    {
      connection: getRedis(),
      concurrency: 1, // Process one file at a time for now
    }
  )

  worker.on('ready', () => {
    logger.info(`👷 [Worker] Listening to queue: ${UPLOAD_QUEUE_NAME}`)
  })

  worker.on('error', (err) => {
    logger.error('👷 [Worker] Error:', err)
  })

  return worker
}
