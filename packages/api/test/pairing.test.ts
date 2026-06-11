import { describe, it, expect } from 'vitest';
import { fisherYatesShuffle, pairNight } from '../src/domain/pairing';
import type { Signup } from '@club-night/shared';

function signup(id: string, systemKey: Signup['systemKey']): Signup {
  return {
    signupId: id,
    nightId: 'night-1',
    clubId: 'club-1',
    playerName: `Player ${id}`,
    email: `${id}@example.com`,
    systemKey,
    status: 'CONFIRMED',
  };
}

const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

describe('fisherYatesShuffle', () => {
  it('returns a permutation of the input', () => {
    const input = [1, 2, 3, 4, 5];
    const shuffled = fisherYatesShuffle(input, () => 0.5);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3];
    fisherYatesShuffle(input, () => 0);
    expect(input).toEqual([1, 2, 3]);
  });

  it('is deterministic for a fixed rng', () => {
    expect(fisherYatesShuffle(['a', 'b', 'c'], () => 0)).toEqual(['b', 'c', 'a']);
  });
});

describe('pairNight', () => {
  it('pairs two players in the same system', () => {
    const { pairings, unpaired } = pairNight(
      [signup('a', 'WARHAMMER_40K'), signup('b', 'WARHAMMER_40K')],
      identityShuffle,
    );
    expect(unpaired).toEqual([]);
    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.systemKey).toBe('WARHAMMER_40K');
    expect(pairings[0]!.players.map((p) => p.signupId)).toEqual(['a', 'b']);
    expect(pairings[0]!.players[0]!.signupId).not.toBe(pairings[0]!.players[1]!.signupId);
  });

  it('flags the odd player out as unpaired', () => {
    const { pairings, unpaired } = pairNight(
      [
        signup('a', 'WARHAMMER_40K'),
        signup('b', 'WARHAMMER_40K'),
        signup('c', 'WARHAMMER_40K'),
      ],
      identityShuffle,
    );
    expect(pairings).toHaveLength(1);
    expect(unpaired.map((s) => s.signupId)).toEqual(['c']);
  });

  it('pairs each system independently', () => {
    const { pairings, unpaired } = pairNight(
      [
        signup('a', 'WARHAMMER_40K'),
        signup('b', 'WARHAMMER_40K'),
        signup('c', 'BLOOD_BOWL'),
      ],
      identityShuffle,
    );
    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.systemKey).toBe('WARHAMMER_40K');
    expect(unpaired.map((s) => s.signupId)).toEqual(['c']);
  });

  it('returns an empty result for no signups', () => {
    expect(pairNight([], identityShuffle)).toEqual({ pairings: [], unpaired: [] });
  });

  it('produces one pairing per full system across multiple systems', () => {
    const { pairings, unpaired } = pairNight(
      [
        signup('a', 'WARHAMMER_40K'), signup('b', 'WARHAMMER_40K'),
        signup('c', 'BLOOD_BOWL'), signup('d', 'BLOOD_BOWL'),
      ],
      identityShuffle,
    );
    expect(pairings).toHaveLength(2);
    expect(unpaired).toEqual([]);
    expect(pairings.map((p) => p.systemKey).sort()).toEqual(['BLOOD_BOWL', 'WARHAMMER_40K']);
  });
});
