import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { listSignupsByNight } from '../../src/repositories/signups';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
});

function post(body: unknown) {
  return createApp().request('/clubs/red-dice/nights/night-1/signups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = { playerName: 'Ada', email: 'Ada@Example.com', systemKey: 'WARHAMMER_40K' };

describe('POST /clubs/:slug/nights/:nightId/signups', () => {
  it('creates a signup on an open night and lowercases the email', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    const res = await post(validBody);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.signup.signupId).toBeTruthy();
    expect(body.signup.email).toBe('ada@example.com');
    expect(body.signup.status).toBe('CONFIRMED');
    expect(await listSignupsByNight('night-1')).toHaveLength(1);
  });

  it('rejects invalid input with a 400', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    const res = await post({ playerName: '', email: 'nope', systemKey: 'CHESS' });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects signup when the night is not open with a 409', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'CLOSED' }));
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect((await res.json() as any).error.code).toBe('CONFLICT');
  });

  it('404s when the night does not exist', async () => {
    const res = await post(validBody);
    expect(res.status).toBe(404);
  });

  it('rejects a system the night does not offer with a 400', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    const res = await post({ ...validBody, systemKey: 'AGE_OF_SIGMAR' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
  });
});
