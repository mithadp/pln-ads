/**
 * PLN-ADS Backend - Express App Setup
 * Configure middleware, routes, and error handling
 */

import express from 'express'
import cors from 'cors'
import { logger } from './utils/logger'
import { errorHandler } from './middleware/errorHandler'
import uploadRoutes from './routes/upload'
import uploadLogsRoutes from './routes/uploadLogs'
import statsRoutes from './routes/stats'       // FIX 4: route baru
import anomalyAnalysisRoutes from './routes/anomalyAnalysis'
import forecastRoutes from './routes/forecast'   // FIX 4: route baru
import idpelListRoutes from './routes/idpelList'

const app = express()

// ==========================================
// MIDDLEWARE
// ==========================================

app.set('trust proxy', 1)

// Allow multiple origins by splitting on commas. Trim each entry so an env
// value like "http://localhost:3002, http://172.22.96.1:3002" still matches
// the browser's Origin header (whitespace would otherwise break the compare).
app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3002')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
)

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true }))

app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`)
  next()
})

// ==========================================
// ROUTES
// ==========================================

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  })
})

app.get('/api/version', (_req, res) => {
  res.status(200).json({ version: '1.0.0', name: 'PLN-ADS Backend' })
})

// FIX 4: Semua route aktif — tidak ada yang dikomentari
app.use('/api/upload', uploadRoutes)
app.use('/api/upload-logs', uploadLogsRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/anomaly-analysis', anomalyAnalysisRoutes)
app.use('/api/forecast', forecastRoutes)
app.use('/api/idpel-list', idpelListRoutes)

// ==========================================
// 404 HANDLER
// ==========================================

app.use((_req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: _req.path,
    method: _req.method,
  })
})

// ==========================================
// GLOBAL ERROR HANDLER
// ==========================================

app.use(errorHandler)

export default app
