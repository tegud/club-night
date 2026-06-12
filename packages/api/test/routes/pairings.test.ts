import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight, sampleMembership } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { putMembership } from '../../src/repositories/memberships';
import { upsertSignup } from '../../src/repositories/signups';
import { setCognitoVerifier } from '../../src/auth/cognito';
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
