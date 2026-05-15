/**
 * Redis Configuration
 * Initialize Redis client for BullMQ job queue
 */

import Redis from 'ioredis'
import { getEnv } from './env'
import { logger } from '../utils/logger'

let redisClient: Redis | null = null

export const initRedis = () => {
  try {
    const env = getEnv()

    redisClient = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: true,
    })

    redisClient.on('connect', () => {
      logger.info('✅ Redis client connected')
    })

    redisClient.on('error', (error) => {
      logger.error('❌ Redis connection error', error)
    })

    redisClient.on('close', () => {
      logger.info('⏸️  Redis client disconnected')
    })

    return redisClient
  } catch (error) {
    logger.error('❌ Failed to initialize Redis client', error)
    throw error
  }
}

export const getRedis = () => {
  if (!redisClient) {
    return initRedis()
  }
  return redisClient
}

export const disconnectRedis = async () => {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
    logger.info('✅ Redis client disconnected')
  }
}
