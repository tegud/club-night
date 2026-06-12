import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleMembership, sampleNight } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putMembership } from '../../src/repositories/memberships';
import { listNightsByClub, getNight, putNight } from '../../src/repositories/nights';
import { setCognitoVerifier } from '../../src/auth/cognito';
import { upsertSignup } from '../../src/repositories/signups';
import { createApp } from '../../src/app';

const ORGANIZER_TOKEN = 'organizer-token';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub()); // enabledSystems: WARHAMMER_40K, BLOOD_BOWL
  await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
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

const validBody = {
  title: 'Thursday Night',
  eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z',
  offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }],
};

function createNight(body: unknown, token?: string) {
  return createApp().request('/clubs/red-dice/nights', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /clubs/:slug/nights (organizer)', () => {
  it('creates an OPEN night for an organizer', async () => {
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.night.nightId).toBeTruthy();
    expect(body.night.status).toBe('OPEN');
    expect(body.night.eventType).toBe('SCHEDULED_GAME_NIGHT');
    expect(body.night.createdBy).toBe('user-1');
    expect(await listNightsByClub('club-1')).toHaveLength(1);
  });

  it('rejects an offered system not enabled for the club (400)', async () => {
    const res = await createNight(
      { ...validBody, offeredSystems: [{ systemKey: 'AGE_OF_SIGMAR', prominent: true }] },
      ORGANIZER_TOKEN,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await createNight(validBody);
    expect(res.status).toBe(401);
  });

  it('rejects a non-organizer (no membership) with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(403);
  });

  it('rejects an organizer of a different club with 403', async () => {
    await putClub(sampleClub({ clubId: 'club-2', slug: 'blue-dice' }));
    await putMembership(sampleMembership({ clubId: 'club-2', userId: 'user-2', role: 'OWNER' }));
    setCognitoVerifier({ verify: async () => ({ sub: 'user-2', email: 'org2@example.com' }) });
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(403);
  });
});

function updateNight(nightId: string, body: unknown, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/${nightId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /clubs/:slug/nights/:nightId (organizer)', () => {
  beforeEach(async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  });

  it('updates the title for an organizer', async () => {
    const res = await updateNight('night-1', { title: 'Renamed Night' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).night.title).toBe('Renamed Night');
    expect((await getNight('club-1', 'night-1'))!.title).toBe('Renamed Night');
  });

  it('cancels a night via a status change', async () => {
    const res = await updateNight('night-1', { status: 'CANCELLED' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await getNight('club-1', 'night-1'))!.status).toBe('CANCELLED');
  });

  it('rejects an offered system not enabled for the club (400)', async () => {
    const res = await updateNight(
      'night-1',
      { offeredSystems: [{ systemKey: 'AGE_OF_SIGMAR', prominent: true }] },
      ORGANIZER_TOKEN,
    );
    expect(res.status).toBe(400);
  });

  it('404s for an unknown night', async () => {
    const res = await updateNight('missing', { title: 'x' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(404);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await updateNight('night-1', { title: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects a PLAYER member with 403', async () => {
    await putMembership(sampleMembership({ userId: 'player-1', role: 'PLAYER' }));
    setCognitoVerifier({ verify: async () => ({ sub: 'player-1', email: 'p@x.com' }) });
    const res = await updateNight('night-1', { title: 'x' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(403);
  });
});

function listSignups(nightId: string, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/${nightId}/signups`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('GET /clubs/:slug/nights/:nightId/signups (organizer)', () => {
  beforeEach(async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    await upsertSignup({
      nightId: 'night-1',
      clubId: 'club-1',
      playerName: 'Ada',
      email: 'ada@example.com',
      systemKey: 'WARHAMMER_40K',
    });
  });

  it('returns the signups for an organizer', async () => {
    const res = await listSignups('night-1', ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.signups).toHaveLength(1);
    expect(body.signups[0].playerName).toBe('Ada');
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await listSignups('night-1');
    expect(res.status).toBe(401);
  });

  it('404s for an unknown night', async () => {
    const res = await listSignups('missing', ORGANIZER_TOKEN);
    expect(res.status).toBe(404);
  });
});
