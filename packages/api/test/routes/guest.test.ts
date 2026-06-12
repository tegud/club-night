import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';
import { verifyGuestSession } from '../../src/auth/guest-session';
import { createApp } from '../../src/app';

let email: FakeEmailSender;

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
  email = new FakeEmailSender();
  setEmailSender(email);
});

afterEach(() => {
  setEmailSender(undefined);
});

function requestCode(body: unknown) {
  return createApp().request('/clubs/red-dice/guest/request-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function verifyCode(body: unknown) {
  return createApp().request('/clubs/red-dice/guest/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('guest code endpoints', () => {
  it('emails a code on request and exchanges it for a session token', async () => {
    const reqRes = await requestCode({ email: 'Ada@Example.com' });
    expect(reqRes.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    const code = email.sent[0]!.text.match(/(\d{6})/)![1]!;

    const verRes = await verifyCode({ email: 'ada@example.com', code });
    expect(verRes.status).toBe(200);
    const token = ((await verRes.json()) as { token: string }).token;
    expect(await verifyGuestSession(token)).toEqual({ email: 'ada@example.com', clubId: 'club-1' });
  });

  it('rejects a wrong code with 401', async () => {
    await requestCode({ email: 'ada@example.com' });
    const res = await verifyCode({ email: 'ada@example.com', code: '000000' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an already-used code with 401 (single use)', async () => {
    await requestCode({ email: 'ada@example.com' });
    const code = email.sent[0]!.text.match(/(\d{6})/)![1]!;
    await verifyCode({ email: 'ada@example.com', code });
    const second = await verifyCode({ email: 'ada@example.com', code });
    expect(second.status).toBe(401);
  });

  it('validates the request body (400 on bad email)', async () => {
    const res = await requestCode({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('validates the verify-code body (400 when code is missing)', async () => {
    await requestCode({ email: 'ada@example.com' });
    const res = await verifyCode({ email: 'ada@example.com' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when the club does not exist', async () => {
    const res = await createApp().request('/clubs/missing/guest/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    });
    expect(res.status).toBe(404);
  });
});
