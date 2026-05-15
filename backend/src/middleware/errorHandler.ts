/**
 * Global Error Handler Middleware
 * Handles all errors thrown in Express handlers
 */

import { Request, Response, NextFunction } from 'express'
import { AppError, InternalServerError } from '../utils/errors'
import { logger } from '../utils/logger'

export const errorHandler = (
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  logger.error(`Error on ${req.method} ${req.path}`, error)

  // Ensure error is an AppError
  let appError: AppError

  if (error instanceof AppError) {
    appError = error
  } else if (error instanceof Error) {
    appError = new InternalServerError(error.message)
  } else {
    appError = new InternalServerError('An unknown error occurred')
  }

  // Send response
  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(process.env.NODE_ENV === 'development' && { details: appError.details }),
    },
    timestamp: new Date().toISOString(),
    path: req.path,
  })
}
