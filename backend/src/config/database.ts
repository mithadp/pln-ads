/**
 * Supabase Database Configuration
 * Initialize Supabase client for API
 */

import { createClient } from '@supabase/supabase-js'
import { getEnv } from './env'
import { logger } from '../utils/logger'

let supabaseClient: any = null

export const initSupabase = () => {
  try {
    const env = getEnv()

    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })

    logger.info('✅ Supabase client initialized')
    return supabaseClient
  } catch (error) {
    logger.error('❌ Failed to initialize Supabase client', error)
    throw error
  }
}

export const getSupabase = () => {
  if (!supabaseClient) {
    return initSupabase()
  }
  return supabaseClient
}

/**
 * Create Supabase service role client (for admin operations)
 * This client has full access to all data, use carefully!
 */
export const initSupabaseService = () => {
  try {
    const env = getEnv()

    const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })

    logger.info('✅ Supabase service role client initialized')
    return serviceClient
  } catch (error) {
    logger.error('❌ Failed to initialize Supabase service client', error)
    throw error
  }
}

let supabaseServiceClient: any = null

export const getSupabaseService = () => {
  if (!supabaseServiceClient) {
    supabaseServiceClient = initSupabaseService()
  }
  return supabaseServiceClient
}
