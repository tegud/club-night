import { describe, it, expect } from 'vitest';
import { issueGuestSession, verifyGuestSession } from '../../src/auth/guest-session';

describe('guest session JWT', () => {
  it('round-trips email and clubId', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    const session = await verifyGuestSession(token);
    expect(session).toEqual({ email: 'ada@example.com', clubId: 'club-1' });
  });

  it('returns null for a tampered token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    const [header, payload, signature] = token.split('.');
    // Corrupt the payload segment — the signature can no longer match.
    const tampered = `${header}.${payload}X.${signature}`;
    expect(await verifyGuestSession(tampered)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' }, -10);
    expect(await verifyGuestSession(token)).toBeNull();
  });

  it('returns null for an unparseable token', async () => {
    expect(await verifyGuestSession('not-a-jwt')).toBeNull();
  });

  it('returns null for a valid JWT missing the guest tokenType claim', async () => {
    const { SignJWT } = await import('jose');
    const raw = await new SignJWT({ email: 'x@example.com', clubId: 'c1' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(process.env.GUEST_JWT_SECRET!));
    expect(await verifyGuestSession(raw)).toBeNull();
  });
});
