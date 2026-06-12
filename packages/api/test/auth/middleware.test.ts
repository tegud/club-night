import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, type AppEnv } from '../../src/auth/middleware';
import { issueGuestSession } from '../../src/auth/guest-session';
import { setCognitoVerifier } from '../../src/auth/cognito';

afterEach(() => {
  setCognitoVerifier(undefined);
});

function probeApp() {
  const app = new Hono<AppEnv>();
  app.use('*', authMiddleware);
  app.get('/whoami', (c) => c.json({ principal: c.get('principal') ?? null }));
  return app;
}

describe('authMiddleware', () => {
  it('sets a guest principal from a guest-session bearer token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    const res = await probeApp().request('/whoami', { headers: { authorization: `Bearer ${token}` } });
    expect((await res.json() as any).principal).toEqual({ kind: 'guest', email: 'ada@example.com', clubId: 'club-1' });
  });

  it('sets null when there is no Authorization header', async () => {
    const res = await probeApp().request('/whoami');
    expect((await res.json() as any).principal).toBeNull();
  });

  it('sets a cognito principal from a cognito bearer token', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'user-1', email: 'olivia@example.com' }) });
    const res = await probeApp().request('/whoami', { headers: { authorization: 'Bearer cognito-token' } });
    expect((await res.json() as any).principal).toEqual({
      kind: 'cognito',
      userId: 'user-1',
      email: 'olivia@example.com',
    });
  });
});
