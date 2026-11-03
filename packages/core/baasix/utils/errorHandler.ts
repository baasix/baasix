/**
 * API Error class for standardized error handling
 */
export class APIError extends Error {
  public statusCode: number;
  public isOperational: boolean;
  public details: any;

  constructor(message: string, statusCode: number = 500, details: any = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;

    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Generate a short correlation id so an operator can find the full error in the
 * server logs from the (sanitized) client response. Uses a timestamp + random
 * suffix; avoids Date.now()/Math.random pitfalls by reading process.hrtime.
 */
function makeCorrelationId(): string {
  const t = process.hrtime.bigint().toString(36);
  const r = (process.pid * 2654435761 % 0xffffffff).toString(36);
  return `${t}-${r}`.slice(-16);
}

/**
 * Whether to include raw DB/internal error text in responses. Off by default in
 * production (leaking PG messages aids schema enumeration and is an injection
 * oracle); set EXPOSE_ERROR_DETAILS=true to include details (e.g. in dev/staging).
 */
function exposeErrorDetails(): boolean {
  if (process.env.EXPOSE_ERROR_DETAILS === 'true') return true;
  if (process.env.EXPOSE_ERROR_DETAILS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Error handler middleware
 */
export function errorHandler(error: Error | APIError, req: any, res: any, next: any): void {
  // Check for APIError by instanceof OR by properties (handles npm link scenarios)
  const isAPIError = error instanceof APIError ||
                     (error as any).name === 'APIError' ||
                     (typeof (error as any).statusCode === 'number' && (error as any).isOperational);

  if (isAPIError) {
    // APIError is intentionally-surfaced application error — message/details are
    // author-controlled, so they're safe to return as-is.
    const apiError = error as APIError;
    // The request carried a token that failed validation (authMiddleware fell
    // back to the public role): a permission refusal means "re-authenticate",
    // so answer 401 and let clients refresh instead of showing Forbidden.
    if (apiError.statusCode === 403 && req?.authTokenRejected) {
      res.set('WWW-Authenticate', 'Bearer error="invalid_token"');
      return res.status(401).json({
        error: { message: 'Session expired or invalid', code: 'INVALID_SESSION', statusCode: 401 }
      });
    }
    res.status(apiError.statusCode).json({
      error: {
        message: apiError.message,
        details: apiError.details,
        statusCode: apiError.statusCode
      }
    });
  } else {
    // Database / unexpected errors. NEVER reflect raw pg `message`/`detail` to the
    // client by default — those leak table/column names, values, and query
    // fragments (schema enumeration + SQL-injection oracle). Always log the full
    // error server-side with a correlation id; the client gets a safe summary.
    const pgError = error as any;
    const expose = exposeErrorDetails();

    // Unique constraint violation (PostgreSQL error code 23505)
    if (pgError.code === '23505' || pgError.message?.includes('unique constraint') || pgError.message?.includes('duplicate key')) {
      return res.status(409).json({
        error: {
          message: 'Unique constraint violation',
          // pgError.detail contains the conflicting VALUE — never expose it.
          details: expose ? (pgError.detail || pgError.message) : 'A record with this value already exists',
          statusCode: 409
        }
      });
    }

    // Foreign key constraint violation (PostgreSQL error code 23503)
    if (pgError.code === '23503' || pgError.message?.includes('foreign key constraint')) {
      // A user delete blocked by a RESTRICT/NO ACTION usertrack FK
      // (fk_<collection>_userCreated_Id / _userUpdated_Id, see USERTRACK_ON_DELETE)
      const constraint = String(pgError.constraint_name || pgError.constraint || '');
      if (/_user(Created|Updated)_Id$/.test(constraint) && String(pgError.detail || '').includes('still referenced')) {
        return res.status(409).json({
          error: {
            message: 'This user has created or updated records and cannot be deleted. Set their status to inactive instead.',
            code: 'USER_HAS_RECORDS',
            details: expose ? (pgError.detail || pgError.message) : 'User is still referenced by other records',
            statusCode: 409
          }
        });
      }
      return res.status(409).json({
        error: {
          message: 'Foreign key constraint violation',
          // pg detail "... is still referenced from table ..." = a delete blocked by RESTRICT/NO ACTION
          details: expose ? (pgError.detail || pgError.message)
            : String(pgError.detail || '').includes('still referenced') ? 'Record is still referenced by other records'
            : 'Referenced record does not exist',
          statusCode: 409
        }
      });
    }

    // Not null constraint violation (PostgreSQL error code 23502)
    if (pgError.code === '23502' || pgError.message?.includes('not null constraint')) {
      return res.status(400).json({
        error: {
          // The column name is generally safe to surface for a client to fix input.
          message: 'Required field missing',
          details: pgError.column || 'A required field was not provided',
          statusCode: 400
        }
      });
    }

    const correlationId = makeCorrelationId();
    console.error(`Unexpected error [${correlationId}]:`, error);
    res.status(500).json({
      error: {
        message: 'Internal server error',
        // Raw message only when explicitly exposed; otherwise a correlation id the
        // operator can grep in the logs.
        details: expose ? (pgError.message || error.message) : `Reference: ${correlationId}`,
        statusCode: 500
      }
    });
  }
}
