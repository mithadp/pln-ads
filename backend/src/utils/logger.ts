/**
 * Logger Utility
 * Simple logging wrapper using console (can be upgraded to Winston/Pino later)
 */

import { getEnv } from '../config/env'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const COLORS = {
  reset: '\x1b[0m',
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m', // Green
  warn: '\x1b[33m', // Yellow
  error: '\x1b[31m', // Red
}

class Logger {
  private currentLevel: LogLevel = 'info'

  constructor(level?: LogLevel) {
    try {
      const env = getEnv()
      this.currentLevel = (env.LOG_LEVEL as LogLevel) || 'info'
    } catch {
      this.currentLevel = level || 'info'
    }
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString()
    const levelUpper = level.toUpperCase().padEnd(5)
    const color = COLORS[level]
    const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : ''

    return `${color}[${timestamp}] ${levelUpper}${COLORS.reset} ${message}${dataStr}`
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.currentLevel]
  }

  debug(message: string, data?: unknown): void {
    if (this.shouldLog('debug')) {
      console.log(this.formatMessage('debug', message, data))
    }
  }

  info(message: string, data?: unknown): void {
    if (this.shouldLog('info')) {
      console.log(this.formatMessage('info', message, data))
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, data))
    }
  }

  error(message: string, error?: unknown): void {
    if (this.shouldLog('error')) {
      const errorData = error instanceof Error ? error.message : error
      console.error(this.formatMessage('error', message, errorData))
    }
  }

  setLevel(level: LogLevel): void {
    this.currentLevel = level
  }

  getLevel(): LogLevel {
    return this.currentLevel
  }
}

export const logger = new Logger()
