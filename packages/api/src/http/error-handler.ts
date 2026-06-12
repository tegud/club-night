import type { Context } from 'hono';
import { HttpError, ValidationError } from './errors';

export function onError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    const body: { code: string; message: string; details?: unknown } = {
      code: err.code,
      message: err.message,
    };
    if (err instanceof ValidationError && err.details !== undefined) {
      body.details = err.details;
    }
    return c.json({ error: body }, err.status);
  }

  console.error('Unhandled error', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500);
}
