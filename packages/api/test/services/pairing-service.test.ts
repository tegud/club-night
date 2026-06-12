import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { upsertSignup, putSignup } from '../../src/repositories/signups';
import { listPairingsByNight, putPairing } from '../../src/repositories/pairings';
import { putNight, getNight } from '../../src/repositories/nights';
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';
import { sampleNight } from '../fixtures';
import { generatePairings, publishPairings, resolvePairing, runDeadlinePairing } from '../../src/services/pairing-service';
import { putMembership } from '../../src/repositories/memberships';
import { sampleMembership } from '../fixtures';

beforeEach(async () => {
  await resetTable();
});

// Identity shuffle → deterministic pairing composition in input order.
const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

async function seed(email: string, systemKey: 'WARHAMMER_40K' | 'BLOOD_BOWL') {
  return upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: email, email, systemKey });
}

describe('generatePairings', () => {
  beforeEach(async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  });

  it('pairs confirmed signups within each system and flags odd ones', async () => {
    await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await seed('c@x.com', 'WARHAMMER_40K'); // odd
    await seed('d@x.com', 'BLOOD_BOWL');
    await seed('e@x.com', 'BLOOD_BOWL');

    const pairings = await generatePairings('club-1', 'night-1', identityShuffle);

    const matched = pairings.filter((p) => p.status === 'MATCHED');
    const needsResolution = pairings.filter((p) => p.status === 'NEEDS_RESOLUTION');
    expect(matched).toHaveLength(2); // 1 x 40k pair + 1 x blood bowl pair
    expect(needsResolution).toHaveLength(1); // the odd 40k player
    expect(needsResolution[0]!.players).toHaveLength(1);
    expect(matched.every((p) => p.players.length === 2)).toBe(true);

    // persisted
    expect(await listPairingsByNight('night-1')).toHaveLength(3);
  });

  it('excludes cancelled signups', async () => {
    const a = await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await putSignup({ ...a, status: 'CANCELLED' }); // a withdraws

    const pairings = await generatePairings('club-1', 'night-1', identityShuffle);
    // only b remains confirmed → one NEEDS_RESOLUTION, no MATCHED
    expect(pairings.filter((p) => p.status === 'MATCHED')).toHaveLength(0);
    expect(pairings.filter((p) => p.status === 'NEEDS_RESOLUTION')).toHaveLength(1);
  });

  it('replaces previous pairings on re-generate', async () => {
    await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await generatePairings('club-1', 'night-1', identityShuffle);
    const second = await generatePairings('club-1', 'night-1', identityShuffle);
    // still exactly one matched pairing, not duplicated
    expect(second.filter((p) => p.status === 'MATCHED')).toHaveLength(1);
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
  });

  it('closes signups (sets the night CLOSED) when generating', async () => {
    await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await generatePairings('club-1', 'night-1', identityShuffle);
    expect((await getNight('club-1', 'night-1'))!.status).toBe('CLOSED');
  });
});

describe('publishPairings', () => {
  let email: FakeEmailSender;

  beforeEach(async () => {
    email = new FakeEmailSender();
    setEmailSender(email);
    await putNight(sampleNight({ nightId: 'night-1', status: 'CLOSED' }));
  });

  afterEach(() => {
    setEmailSender(undefined);
  });

  it('rejects publishing a night that has not been generated/closed yet', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    await expect(publishPairings('club-1', 'night-1')).rejects.toMatchObject({ status: 409 });
  });

  async function seedMatched() {
    const a = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
    const b = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
    await putPairing({
      pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K',
      players: [{ signupId: a.signupId, playerName: 'Ada' }, { signupId: b.signupId, playerName: 'Bob' }],
      status: 'MATCHED',
    });
  }

  it('emails both matched players and marks the night PAIRED', async () => {
    await seedMatched();
    const result = await publishPairings('club-1', 'night-1');
    expect(result.night.status).toBe('PAIRED');
    expect((await getNight('club-1', 'night-1'))!.status).toBe('PAIRED');
    expect(email.sent).toHaveLength(2);
    const toAda = email.sent.find((m) => m.to === 'a@x.com')!;
    const toBob = email.sent.find((m) => m.to === 'b@x.com')!;
    expect(toAda.text).toContain('Bob');
    expect(toBob.text).toContain('Ada');
  });

  it('is idempotent — a second publish sends no further emails', async () => {
    await seedMatched();
    await publishPairings('club-1', 'night-1');
    await publishPairings('club-1', 'night-1');
    expect(email.sent).toHaveLength(2);
  });

  it('does not email players in NEEDS_RESOLUTION pairings', async () => {
    const c = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Cy', email: 'c@x.com', systemKey: 'BLOOD_BOWL' });
    await putPairing({
      pairingId: 'odd', nightId: 'night-1', clubId: 'club-1', systemKey: 'BLOOD_BOWL',
      players: [{ signupId: c.signupId, playerName: 'Cy' }], status: 'NEEDS_RESOLUTION',
    });
    const result = await publishPairings('club-1', 'night-1');
    expect(result.night.status).toBe('PAIRED');
    expect(email.sent).toHaveLength(0);
  });

  it('still publishes (PAIRED) when an email send fails', async () => {
    await seedMatched();
    setEmailSender({ send: async () => { throw new Error('SES down'); } });
    const result = await publishPairings('club-1', 'night-1');
    expect(result.night.status).toBe('PAIRED');
  });

  it('does not email a player who cancelled after being paired', async () => {
    const a = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
    const b = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
    await putPairing({
      pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K',
      players: [{ signupId: a.signupId, playerName: 'Ada' }, { signupId: b.signupId, playerName: 'Bob' }],
      status: 'MATCHED',
    });
    await putSignup({ ...a, status: 'CANCELLED' });
    await publishPairings('club-1', 'night-1');
    expect(email.sent.map((m) => m.to)).toEqual(['b@x.com']);
  });
});

describe('resolvePairing', () => {
  beforeEach(async () => {
    await putPairing({ pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's1', playerName: 'Ada' }], status: 'NEEDS_RESOLUTION' });
    await putPairing({ pairingId: 'p2', nightId: 'night-1', clubId: 'club-1', systemKey: 'AGE_OF_SIGMAR', players: [{ signupId: 's2', playerName: 'Bob' }], status: 'NEEDS_RESOLUTION' });
  });

  it('merges two unresolved singles into one MATCHED pairing and deletes the absorbed one', async () => {
    const merged = await resolvePairing('night-1', 'p1', 's2');
    expect(merged.status).toBe('MATCHED');
    expect(merged.players.map((p) => p.signupId).sort()).toEqual(['s1', 's2']);
    expect(merged.systemKey).toBe('WARHAMMER_40K');
    const remaining = await listPairingsByNight('night-1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.pairingId).toBe('p1');
  });

  it('throws NotFound for an unknown target pairing', async () => {
    await expect(resolvePairing('night-1', 'missing', 's2')).rejects.toMatchObject({ status: 404 });
  });

  it('throws Conflict when the target is already MATCHED', async () => {
    await putPairing({ pairingId: 'p3', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's4', playerName: 'Di' }, { signupId: 's5', playerName: 'Ed' }], status: 'MATCHED' });
    await expect(resolvePairing('night-1', 'p3', 's2')).rejects.toMatchObject({ status: 409 });
  });

  it('throws Validation when the opponent is not another unresolved single', async () => {
    await expect(resolvePairing('night-1', 'p1', 'nobody')).rejects.toMatchObject({ status: 400 });
  });
});

describe('runDeadlinePairing', () => {
  let email: FakeEmailSender;

  beforeEach(async () => {
    email = new FakeEmailSender();
    setEmailSender(email);
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN', createdBy: 'user-1' }));
    await putMembership(sampleMembership({ clubId: 'club-1', userId: 'user-1', role: 'OWNER', email: 'olivia@example.com' }));
    await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
    await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
  });

  afterEach(() => {
    setEmailSender(undefined);
  });

  it('generates, closes the night, and notifies the organizer (no player emails)', async () => {
    await runDeadlinePairing('club-1', 'night-1');

    expect((await getNight('club-1', 'night-1'))!.status).toBe('CLOSED');
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('olivia@example.com');
    expect(email.sent.some((m) => m.to === 'a@x.com' || m.to === 'b@x.com')).toBe(false);
  });
});
