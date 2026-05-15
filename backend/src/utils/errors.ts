/**
 * Custom Error Classes
 * For consistent error handling across the application
 */

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message)
    Object.setPrototypeOf(this, AppError.prototype)
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details)
    Object.setPrototypeOf(this, ValidationError.prototype)
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', details?: unknown) {
    super(401, 'AUTHENTICATION_ERROR', message, details)
    Object.setPrototypeOf(this, AuthenticationError.prototype)
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Access denied', details?: unknown) {
    super(403, 'AUTHORIZATION_ERROR', message, details)
    Object.setPrototypeOf(this, AuthorizationError.prototype)
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, details?: unknown) {
    super(404, 'NOT_FOUND', `${resource} not found`, details)
    Object.setPrototypeOf(this, NotFoundError.prototype)
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT_ERROR', message, details)
    Object.setPrototypeOf(this, ConflictError.prototype)
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests', details?: unknown) {
    super(429, 'RATE_LIMIT_ERROR', message, details)
    Object.setPrototypeOf(this, RateLimitError.prototype)
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', details?: unknown) {
    super(500, 'INTERNAL_SERVER_ERROR', message, details)
    Object.setPrototypeOf(this, InternalServerError.prototype)
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string, details?: unknown) {
    super(503, 'SERVICE_UNAVAILABLE', `${service} is currently unavailable`, details)
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype)
  }
}
