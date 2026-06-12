import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../src/http/errors';
import { onError } from '../../src/http/error-handler';
import { parseOrThrow } from '../../src/http/validate';

function appThatThrows(err: Error): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/boom', () => {
    throw err;
  });
  return app;
}

describe('http error handling', () => {
  it('maps NotFoundError to a 404 structured body', async () => {
    const res = await appThatThrows(new NotFoundError('Club not found')).request('/boom');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Club not found' } });
  });

  it('maps ConflictError to a 409', async () => {
    const res = await appThatThrows(new ConflictError('Not open')).request('/boom');
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toBe('Not open');
  });

  it('maps an unknown error to a 500 without leaking the message', async () => {
    const res = await appThatThrows(new Error('secret internals')).request('/boom');
    expect(res.status).toBe(500);
    const body = await res.json() as any;
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Something went wrong');
    expect(JSON.stringify(body)).not.toContain('secret internals');
  });
});

describe('parseOrThrow', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('returns parsed data on success', () => {
    expect(parseOrThrow(schema, { name: 'Ada' })).toEqual({ name: 'Ada' });
  });

  it('throws a ValidationError with details on failure', () => {
    try {
      parseOrThrow(schema, { name: '' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).status).toBe(400);
      expect((err as ValidationError).details).toBeDefined();
    }
  });
});
