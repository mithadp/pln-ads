/**
 * Environment Variables Validation
 * Using Zod for runtime type checking
 */

import { z } from 'zod'

// Define environment schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  API_URL: z.string().url().default('http://localhost:3001'),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  // ML-Service
  ML_SERVICE_URL: z.string().url().default('http://localhost:8000'),
  ML_SERVICE_TIMEOUT: z.coerce.number().default(60000),

  // File Upload
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE: z.coerce.number().default(104857600), // 100MB

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // JWT Secret
  JWT_SECRET: z.string().default('dev-secret'),
})

export type Env = z.infer<typeof envSchema>

let validatedEnv: Env | null = null

export const validateEnv = (): Env => {
  if (validatedEnv) {
    return validatedEnv
  }

  try {
    validatedEnv = envSchema.parse(process.env)
    return validatedEnv
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('❌ Environment validation failed:')
      error.errors.forEach((err) => {
        console.error(`  - ${err.path.join('.')}: ${err.message}`)
      })
      process.exit(1)
    }
    throw error
  }
}

export const getEnv = (): Env => {
  if (!validatedEnv) {
    return validateEnv()
  }
  return validatedEnv
}
