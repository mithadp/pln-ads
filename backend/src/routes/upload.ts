import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { Queue } from 'bullmq'
import { getSupabaseService } from '../config/database'
import { getRedis } from '../config/redis'
import { UPLOAD_QUEUE_NAME } from '../constants/config'
import { logger } from '../utils/logger'
import { ValidationError, InternalServerError } from '../utils/errors'

const router = Router()

// Initialize BullMQ Queue
const uploadQueue = new Queue(UPLOAD_QUEUE_NAME, {
  connection: getRedis(),
})

// Ensure uploads directory exists
const uploadDir = path.join(process.cwd(), 'uploads')
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir)
  },
  filename: (_req, file, cb) => {
    // Keep original extension or suffix
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9)
    cb(null, `${uniqueSuffix}-${file.originalname}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
})

/**
 * Map any thrown error to a clean 4xx response with a useful message,
 * instead of bubbling to errorHandler middleware which always 500s.
 * - ValidationError       → 400
 * - Supabase fetch/timeout → 503 (upstream)
 * - Anything else         → 400 with the actual message
 */
const failGracefully = (res: any, error: any, fallbackMessage: string) => {
  const raw = error?.message ?? String(error ?? '')
  const isTimeout = /ConnectTimeoutError|fetch failed|ECONNRESET|ETIMEDOUT/i.test(raw)
  const status = error instanceof ValidationError
    ? 400
    : isTimeout
      ? 503
      : 400
  res.status(status).json({
    success: false,
    message: fallbackMessage,
    error: raw || 'Unknown error',
    hint: isTimeout
      ? 'Network timeout reaching Supabase — retry in a moment.'
      : undefined,
  })
}

// POST /api/upload
router.post('/', upload.single('file'), async (req, res) => {
  let file = req.file
  try {
    const { userId } = req.body

    if (!file) {
      return failGracefully(res, new ValidationError('No file uploaded'), 'No file uploaded')
    }
    if (!userId) {
      return failGracefully(res, new ValidationError('userId is required in the form data'), 'Missing userId')
    }

    logger.info(`📥 Received file upload: ${file.originalname} (${file.size} bytes)`)

    const supabase = getSupabaseService()
    if (!supabase) {
      return failGracefully(res, new InternalServerError('Database client not initialized'), 'Database unavailable')
    }

    // 1. Insert into upload_logs ─────────────────────────────────────────────
    const { data: uploadLog, error: dbError } = await (supabase as any)
      .from('upload_logs')
      .insert({
        user_id: userId,
        file_name: file.originalname,
        file_path: file.path,
        file_size_bytes: file.size,
        status: 'processing',
      })
      .select()
      .single()

    if (dbError) {
      logger.error(`Failed to insert upload log into Supabase: ${dbError.message}`)
      return failGracefully(res, dbError, 'Database error while saving upload log')
    }

    logger.info(`✅ Logged upload in DB with ID: ${uploadLog.id} (status: processing, user: ${userId})`)

    // 2. Add Job to BullMQ ───────────────────────────────────────────────────
    let job
    try {
      job = await uploadQueue.add('process_upload', {
        upload_id: uploadLog.id,
        user_id: userId,
        file_path: file.path,
      })
    } catch (queueErr: any) {
      logger.error(`Failed to enqueue BullMQ job: ${queueErr?.message ?? queueErr}`)
      // Roll the upload_logs row to 'failed' so the UI reflects reality.
      await (supabase as any)
        .from('upload_logs')
        .update({ status: 'failed', error_message: `Queue error: ${queueErr?.message ?? queueErr}` })
        .eq('id', uploadLog.id)
      return failGracefully(res, queueErr, 'Failed to enqueue processing job')
    }

    logger.info(`✅ Added job to queue with ID: ${job.id}`)

    // 3. Audit row in `jobs` (non-fatal if it fails) ─────────────────────────
    const { error: jobDbError } = await (supabase as any).from('jobs').insert({
      upload_id: uploadLog.id,
      type: 'process_upload',
      status: 'pending',
      data: { bullmq_job_id: job.id, file_path: file.path }
    }).select().single()

    if (jobDbError) {
      logger.warn(`Non-fatal: jobs insert failed: ${jobDbError.message}`)
    }

    res.status(200).json({
      success: true,
      message: 'File uploaded and queued successfully',
      data: {
        uploadId: uploadLog.id,
        jobId: job.id,
        status: uploadLog.status,
      },
    })
  } catch (error: any) {
    // Final safety net: anything thrown above lands here as a clean response.
    logger.error(`[upload] Unexpected error: ${error?.message ?? error}`)
    failGracefully(res, error, 'Upload failed')
  }
})

export default router
