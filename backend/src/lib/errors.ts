/**
 * Domain error helpers. Maps cleanly to `{ error: { code, message, details? } }`.
 */

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);

export const unauthorized = (message = 'Unauthorized') =>
  new HttpError(401, 'unauthorized', message);

export const forbidden = (message = 'Forbidden') =>
  new HttpError(403, 'forbidden', message);

export const notFound = (resource = 'Resource') =>
  new HttpError(404, 'not_found', `${resource} not found`);

export const conflict = (message: string, code = 'conflict') =>
  new HttpError(409, code, message);

export const unprocessable = (message: string, details?: unknown) =>
  new HttpError(422, 'unprocessable_entity', message, details);

export const tooManyRequests = (message = 'Too many requests') =>
  new HttpError(429, 'rate_limited', message);
