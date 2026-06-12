import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight, sampleMembership } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { putMembership } from '../../src/repositories/memberships';
import { upsertSignup, getSignup } from '../../src/repositories/signups';
import { issueGuestSession } from '../../src/auth/guest-session';
import { setCognitoVerifier } from '../../src/auth/cognito';
import { createApp } from '../../src/app';

const ORGANIZER_TOKEN = 'organizer-token';
let signupId: string;

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
  await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
  const signup = await upsertSignup({
    nightId: 'night-1',
    clubId: 'club-1',
    playerName: 'Ada',
    email: 'ada@example.com',
    systemKey: 'WARHAMMER_40K',
  });
  signupId = signup.signupId;
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

async function guestToken(email: string, clubId = 'club-1') {
  return issueGuestSession({ email, clubId });
}

function get(id: string, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/signups/${id}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('GET /clubs/:slug/nights/:nightId/signups/:signupId', () => {
  it('returns the signup to its guest owner', async () => {
    const res = await get(signupId, await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.playerName).toBe('Ada');
  });

  it('returns the signup to an organizer', async () => {
    const res = await get(signupId, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
  });

  it('forbids a different guest with 403', async () => {
    const res = await get(signupId, await guestToken('bob@example.com'));
    expect(res.status).toBe(403);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await get(signupId);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown signup', async () => {
    const res = await get('missing', await guestToken('ada@example.com'));
    expect(res.status).toBe(404);
  });
});

function patch(id: string, body: unknown, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/signups/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('PATCH /clubs/:slug/nights/:nightId/signups/:signupId', () => {
  it('lets the guest owner change their system', async () => {
    const res = await patch(signupId, { systemKey: 'BLOOD_BOWL' }, await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.systemKey).toBe('BLOOD_BOWL');
    expect((await getSignup('night-1', signupId))!.systemKey).toBe('BLOOD_BOWL');
  });

  it('rejects a system the night does not offer with 400', async () => {
    const res = await patch(signupId, { systemKey: 'AGE_OF_SIGMAR' }, await guestToken('ada@example.com'));
    expect(res.status).toBe(400);
  });

  it('forbids a different guest with 403', async () => {
    const res = await patch(signupId, { note: 'x' }, await guestToken('bob@example.com'));
    expect(res.status).toBe(403);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await patch(signupId, { note: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects a malformed JSON body with 400', async () => {
    const token = await guestToken('ada@example.com');
    const res = await createApp().request(`/clubs/red-dice/nights/night-1/signups/${signupId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects updating a cancelled signup with 409', async () => {
    await del(signupId, await guestToken('ada@example.com'));
    const res = await patch(signupId, { note: 'x' }, await guestToken('ada@example.com'));
    expect(res.status).toBe(409);
  });
});

function del(id: string, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/signups/${id}`, {
    method: 'DELETE',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('DELETE /clubs/:slug/nights/:nightId/signups/:signupId', () => {
  it('soft-cancels the signup for its guest owner', async () => {
    const res = await del(signupId, await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.status).toBe('CANCELLED');
    expect((await getSignup('night-1', signupId))!.status).toBe('CANCELLED');
  });

  it('lets an organizer cancel any signup', async () => {
    const res = await del(signupId, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await getSignup('night-1', signupId))!.status).toBe('CANCELLED');
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await del(signupId);
    expect(res.status).toBe(401);
  });

  it('forbids a different guest with 403', async () => {
    const res = await del(signupId, await guestToken('bob@example.com'));
    expect(res.status).toBe(403);
  });
});
