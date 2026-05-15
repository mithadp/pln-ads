/**
 * PLN-ADS Backend - Main Entry Point
 * Starts the Express server and initializes all services
 */

import 'dotenv/config'
import app from './app'
import { logger } from './utils/logger'
import { validateEnv } from './config/env'
import { startUploadWorker } from './workers/uploadWorker'

const PORT = process.env.PORT || 3001

const startServer = async () => {
  try {
    // Validate environment variables
    validateEnv()
    logger.info('✅ Environment variables validated')

    // Start background workers
    startUploadWorker()
    logger.info('✅ Background workers started')

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`🚀 Backend server running on http://localhost:${PORT}`)
      logger.info(`📡 Environment: ${process.env.NODE_ENV}`)
    })
  } catch (error) {
    logger.error('❌ Failed to start server', error)
    process.exit(1)
  }
}

startServer()
