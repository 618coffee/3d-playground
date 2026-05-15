export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function toHttpError(error) {
  if (error instanceof HttpError) return error;
  return new HttpError(500, 'internal_error', 'Agent API failed unexpectedly.');
}

export function errorBody(error) {
  const httpError = toHttpError(error);
  return {
    error: {
      code: httpError.code,
      message: httpError.message,
      ...(httpError.details === undefined ? {} : { details: httpError.details }),
    },
  };
}
