import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { upsertSignup, putSignup } from '../../src/repositories/signups';
import { listPairingsByNight } from '../../src/repositories/pairings';
import { generatePairings } from '../../src/services/pairing-service';

beforeEach(async () => {
  await resetTable();
});

// Identity shuffle → deterministic pairing composition in input order.
const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

async function seed(email: string, systemKey: 'WARHAMMER_40K' | 'BLOOD_BOWL') {
  return upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: email, email, systemKey });
}

describe('generatePairings', () => {
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
});
