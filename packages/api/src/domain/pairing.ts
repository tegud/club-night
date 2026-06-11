import type { GameSystemKey, Signup } from '@club-night/shared';

export type Shuffle = <T>(items: readonly T[]) => T[];

export interface ProposedPairing {
  systemKey: GameSystemKey;
  players: [Signup, Signup];
}

export interface PairingResult {
  pairings: ProposedPairing[];
  unpaired: Signup[];
}

/**
 * Fisher–Yates shuffle. Pure given its `rng` (defaults to Math.random in
 * production); inject a fake rng in tests for determinism.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/**
 * Randomly pair confirmed signups within each game system. Any leftover odd
 * player per system is returned in `unpaired` for an organizer to resolve.
 * `shuffle` is injectable for deterministic tests (defaults to Fisher–Yates).
 */
export function pairNight(
  signups: readonly Signup[],
  shuffle: Shuffle = fisherYatesShuffle,
): PairingResult {
  const bySystem = new Map<GameSystemKey, Signup[]>();
  for (const signup of signups) {
    const group = bySystem.get(signup.systemKey) ?? [];
    group.push(signup);
    bySystem.set(signup.systemKey, group);
  }

  const pairings: ProposedPairing[] = [];
  const unpaired: Signup[] = [];

  for (const [systemKey, group] of bySystem) {
    const shuffled = shuffle(group);
    let i = 0;
    for (; i + 1 < shuffled.length; i += 2) {
      pairings.push({ systemKey, players: [shuffled[i]!, shuffled[i + 1]!] });
    }
    if (i < shuffled.length) {
      unpaired.push(shuffled[i]!);
    }
  }

  return { pairings, unpaired };
}
