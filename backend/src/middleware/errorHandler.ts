import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

interface PgError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

function isPgError(err: unknown): err is PgError {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as any).code === 'string';
}

/** Translates well-known Postgres error codes into structured AppErrors. */
function fromPgError(err: PgError): AppError | null {
  switch (err.code) {
    case '23505': // unique_violation
      return new AppError(409, 'CONFLICT', `A record with this value already exists${err.constraint ? ` (${err.constraint})` : ''}`);
    case '23503': // foreign_key_violation
      return new AppError(422, 'INVALID_REFERENCE', 'Referenced record does not exist');
    case '23502': // not_null_violation
      return new AppError(422, 'VALIDATION_ERROR', 'A required field was missing');
    case '22P02': // invalid_text_representation (e.g. bad UUID/enum literal)
      return new AppError(422, 'VALIDATION_ERROR', 'One or more fields had an invalid format');
    default:
      return null;
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, path: req.path }, 'Request failed');
    }
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, details: err.details ?? undefined },
    });
    return;
  }

  if (isPgError(err)) {
    const mapped = fromPgError(err);
    if (mapped) {
      res.status(mapped.statusCode).json({ error: { code: mapped.code, message: mapped.message } });
      return;
    }
  }

  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
  });
}
