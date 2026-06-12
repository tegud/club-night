import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import {
  upsertSignup,
  getSignup,
  listSignupsByNight,
  findSignupByEmail,
} from '../../src/repositories/signups';

beforeEach(async () => {
  await resetTable();
});

const base = {
  nightId: 'night-1',
  clubId: 'club-1',
  playerName: 'Ada',
  email: 'ada@example.com',
  systemKey: 'WARHAMMER_40K' as const,
};

describe('signups repository', () => {
  it('creates a confirmed signup with a generated id', async () => {
    const signup = await upsertSignup(base);
    expect(signup.signupId).toBeTruthy();
    expect(signup.status).toBe('CONFIRMED');
    const fetched = await getSignup('night-1', signup.signupId);
    expect(fetched!.playerName).toBe('Ada');
  });

  it('updates the same signup when the email repeats for a night (one per email)', async () => {
    const first = await upsertSignup(base);
    const second = await upsertSignup({ ...base, playerName: 'Ada L.', systemKey: 'BLOOD_BOWL' });
    expect(second.signupId).toBe(first.signupId);
    const all = await listSignupsByNight('night-1');
    expect(all).toHaveLength(1);
    expect(all[0]!.playerName).toBe('Ada L.');
    expect(all[0]!.systemKey).toBe('BLOOD_BOWL');
  });

  it('treats the same email on different nights as separate signups', async () => {
    await upsertSignup(base);
    await upsertSignup({ ...base, nightId: 'night-2' });
    expect(await listSignupsByNight('night-1')).toHaveLength(1);
    expect(await listSignupsByNight('night-2')).toHaveLength(1);
  });

  it('finds a signup by night + email', async () => {
    await upsertSignup(base);
    const found = await findSignupByEmail('night-1', 'ada@example.com');
    expect(found!.playerName).toBe('Ada');
  });

  it('persists an optional note', async () => {
    const signup = await upsertSignup({ ...base, note: 'First time!' });
    const fetched = await getSignup('night-1', signup.signupId);
    expect(fetched!.note).toBe('First time!');
  });

  it('creates a guest signup with no userId', async () => {
    const signup = await upsertSignup(base);
    expect(signup.userId).toBeUndefined();
    const fetched = await getSignup('night-1', signup.signupId);
    expect(fetched!.userId).toBeUndefined();
  });
});
