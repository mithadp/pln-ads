/**
 * GET /api/idpel-list
 * Returns distinct {idpel, unitup} pairs sorted by latest upload first
 * (newest at the top of the dropdown). Frontend uses this for searchable
 * IDPEL selectors in the Anomaly and Forecast tabs.
 *
 * Note: Supabase JS client has no DISTINCT operator, so we dedupe in-memory.
 * Sort by created_at DESC and KEEP THE FIRST occurrence — that's the latest
 * upload for any given customer_id.
 *
 * Contract: always 200, [] on any error.
 */

import { Router } from 'express'
import { getSupabaseService } from '../config/database'
import { logger } from '../utils/logger'

const router = Router()

interface CustomerRow {
  customer_id: string | null
  unitup: string | null
  created_at: string | null
}

interface IdpelEntry {
  idpel: string
  unitup: string
}

router.get('/', async (_req, res) => {
  try {
    const supabase = getSupabaseService()

    const { data, error } = await supabase
      .from('consumption_data')
      .select('customer_id, unitup, created_at')
      .order('created_at', { ascending: false })
      .limit(50000)

    if (error) {
      logger.warn(`[idpel-list] Supabase error, returning []: ${error.message}`)
      res.status(200).json([])
      return
    }

    // Keep the FIRST occurrence per customer_id — rows are newest-first, so
    // this preserves the most recently uploaded record for each IDPEL.
    const seen = new Map<string, string>()
    for (const row of (data ?? []) as CustomerRow[]) {
      const id = row.customer_id?.trim()
      if (!id || seen.has(id)) continue
      seen.set(id, row.unitup ?? '')
    }

    const idpels: IdpelEntry[] = Array.from(seen.entries()).map(([idpel, unitup]) => ({
      idpel,
      unitup,
    }))

    logger.info(`[idpel-list] Returning ${idpels.length} distinct IDPELs (newest first)`)
    res.status(200).json(idpels)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`[idpel-list] Unexpected error, returning []: ${message}`)
    res.status(200).json([])
  }
})

export default router
