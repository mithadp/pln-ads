/**
 * GET /api/upload-logs
 * Returns the upload history (newest first). Optional ?user_id query.
 * Contract: always responds 200 — empty/missing table degrades to [].
 */

import { Router } from 'express'
import { getSupabaseService } from '../config/database'
import { logger } from '../utils/logger'

const router = Router()

router.get('/', async (req, res) => {
  try {
    const supabase = getSupabaseService()
    const { user_id, limit = '100' } = req.query

    let query = supabase
      .from('upload_logs')
      .select('id, user_id, file_name, file_size_bytes, status, rows_total, rows_success, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(Number(limit))

    if (user_id && typeof user_id === 'string') {
      query = query.eq('user_id', user_id)
    }

    const { data, error } = await query

    if (error) {
      logger.warn(`[upload-logs] Supabase error, returning []: ${error.message}`)
      res.status(200).json([])
      return
    }

    logger.info(`[upload-logs] Returning ${data?.length ?? 0} records`)
    res.status(200).json(data ?? [])
  } catch (error: any) {
    logger.error(`[upload-logs] Unexpected error, returning []: ${error?.message ?? error}`)
    res.status(200).json([])
  }
})

export default router
