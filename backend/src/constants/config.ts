/**
 * Application Constants & Configuration
 */

export const UPLOAD_QUEUE_NAME = 'ml-prediction-queue'

export const ANOMALY_THRESHOLDS = {
  LOW: 0.3,
  MEDIUM: 0.6,
  HIGH: 0.8,
}

export const ANOMALY_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
}

export const UPLOAD_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
}

export const ANOMALY_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
}

export const ML_MODELS = {
  ISOLATION_FOREST: 'isolation_forest',
  RANDOM_FOREST: 'random_forest',
}

export const CSV_HEADERS = ['date', 'customer_id', 'customer_name', 'kwh_usage']

export const JOB_CONFIG = {
  MAX_ATTEMPTS: 3,
  BACKOFF_DELAY: 5000, // 5 seconds
  TIMEOUT: 300000, // 5 minutes
  BATCH_SIZE: 10000, // 10K rows per batch
}
