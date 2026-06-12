import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight, sampleMembership } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { getNight, putNight } from '../../src/repositories/nights';
import { putMembership } from '../../src/repositories/memberships';
import { upsertSignup } from '../../src/repositories/signups';
import { putPairing } from '../../src/repositories/pairings';
import { setCognitoVerifier } from '../../src/auth/cognito';
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';
import { createApp } from '../../src/app';

const ORGANIZER_TOKEN = 'organizer-token';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
  await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
  await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
  await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
  setCognitoVerifier({
    verify: async (token) => {
      if (token !== ORGANIZER_TOKEN) throw new Error('invalid');
      return { sub: 'user-1', email: 'olivia@example.com' };
    },
  });
});

afterEach(() => {
  setCognitoVerifier(undefined);
});

function generate(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/pairings/generate', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

function view(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/pairings', {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('POST /clubs/:slug/nights/:nightId/pairings/generate', () => {
  it('generates pairings for an organizer', async () => {
    const res = await generate(ORGANIZER_TOKEN);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.pairings).toHaveLength(1);
    expect(body.pairings[0].status).toBe('MATCHED');
    expect(body.pairings[0].players).toHaveLength(2);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await generate()).status).toBe(401);
  });

  it('rejects a non-organizer with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    expect((await generate(ORGANIZER_TOKEN)).status).toBe(403);
  });

  it('404s when the night does not exist', async () => {
    const res = await createApp().request('/clubs/red-dice/nights/missing/pairings/generate', {
      method: 'POST',
      headers: { authorization: `Bearer ${ORGANIZER_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /clubs/:slug/nights/:nightId/pairings', () => {
  // 403 (non-organizer) and 404 (missing night) are covered by the generate tests
  // above — both endpoints share requireOrganizer + requireNight.
  it('returns generated pairings to an organizer', async () => {
    await generate(ORGANIZER_TOKEN);
    const res = await view(ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json() as any).pairings).toHaveLength(1);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await view()).status).toBe(401);
  });
});

function publish(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/pairings/publish', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('POST /clubs/:slug/nights/:nightId/pairings/publish', () => {
  afterEach(() => setEmailSender(undefined));

  it('publishes pairings and marks the night PAIRED for an organizer', async () => {
    const email = new FakeEmailSender();
    setEmailSender(email);
    await generate(ORGANIZER_TOKEN); // 1 MATCHED pairing from the 2 seeded 40k signups
    const res = await publish(ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json() as any).night.status).toBe('PAIRED');
    expect((await getNight('club-1', 'night-1'))!.status).toBe('PAIRED');
    expect(email.sent).toHaveLength(2);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await publish()).status).toBe(401);
  });

  it('rejects a non-organizer with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    expect((await publish(ORGANIZER_TOKEN)).status).toBe(403);
  });
});

describe('POST .../pairings/generate when already PAIRED', () => {
  it('rejects re-generation of a published night with 409', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'PAIRED' }));
    const res = await generate(ORGANIZER_TOKEN);
    expect(res.status).toBe(409);
  });
});

function resolve(pairingId: string, body: unknown, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/pairings/${pairingId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('PATCH /clubs/:slug/nights/:nightId/pairings/:pairingId', () => {
  beforeEach(async () => {
    await putPairing({ pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's1', playerName: 'Ada' }], status: 'NEEDS_RESOLUTION' });
    await putPairing({ pairingId: 'p2', nightId: 'night-1', clubId: 'club-1', systemKey: 'BLOOD_BOWL', players: [{ signupId: 's2', playerName: 'Bob' }], status: 'NEEDS_RESOLUTION' });
  });

  it('merges two singles for an organizer', async () => {
    const res = await resolve('p1', { opponentSignupId: 's2' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json() as any).pairing.status).toBe('MATCHED');
  });

  it('rejects a bad opponent with 400', async () => {
    const res = await resolve('p1', { opponentSignupId: 'nobody' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(400);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await resolve('p1', { opponentSignupId: 's2' })).status).toBe(401);
  });

  it('rejects a non-organizer with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    const res = await resolve('p1', { opponentSignupId: 's2' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(403);
  });

  it('rejects resolving on an already-PAIRED night with 409', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'PAIRED' }));
    const res = await resolve('p1', { opponentSignupId: 's2' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(409);
  });
});
