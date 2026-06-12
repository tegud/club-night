import { ulid } from 'ulid';
import type { Pairing, PairingPlayer, Signup } from '@club-night/shared';
import { pairNight, fisherYatesShuffle, type Shuffle } from '../domain/pairing';
import { listSignupsByNight } from '../repositories/signups';
import { deletePairingsByNight, putPairing } from '../repositories/pairings';

function toPlayer(signup: Signup): PairingPlayer {
  return { signupId: signup.signupId, playerName: signup.playerName };
}

/**
 * Generate random within-system pairings for a night from its CONFIRMED signups.
 * Clears any existing pairings first (so this is also "re-roll"). `shuffle` is
 * injectable for deterministic tests; defaults to Fisher–Yates.
 */
export async function generatePairings(
  clubId: string,
  nightId: string,
  shuffle: Shuffle = fisherYatesShuffle,
): Promise<Pairing[]> {
  const confirmed = (await listSignupsByNight(nightId)).filter((s) => s.status === 'CONFIRMED');
  const { pairings, unpaired } = pairNight(confirmed, shuffle);

  const result: Pairing[] = [];
  for (const p of pairings) {
    result.push({
      pairingId: ulid(),
      nightId,
      clubId,
      systemKey: p.systemKey,
      players: p.players.map(toPlayer),
      status: 'MATCHED',
    });
  }
  for (const signup of unpaired) {
    result.push({
      pairingId: ulid(),
      nightId,
      clubId,
      systemKey: signup.systemKey,
      players: [toPlayer(signup)],
      status: 'NEEDS_RESOLUTION',
    });
  }

  // Non-atomic: delete-then-write. A crash mid-write leaves partial pairings;
  // callers can re-generate to recover. Acceptable at MVP scale.
  await deletePairingsByNight(nightId);
  for (const pairing of result) {
    await putPairing(pairing);
  }
  return result;
}
