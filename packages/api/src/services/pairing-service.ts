import { ulid } from 'ulid';
import type { GameNight, Pairing, PairingPlayer, Signup } from '@club-night/shared';
import { pairNight, fisherYatesShuffle, type Shuffle } from '../domain/pairing';
import { listSignupsByNight } from '../repositories/signups';
import { deletePairing, deletePairingsByNight, listPairingsByNight, putPairing } from '../repositories/pairings';
import type { EmailSender } from '../email/sender';
import { getEmailSender } from '../email/provider';
import { getNight, putNight } from '../repositories/nights';
import { getMembership } from '../repositories/memberships';
import { ConflictError, NotFoundError, ValidationError } from '../http/errors';

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
  const night = await getNight(clubId, nightId);
  if (!night) throw new NotFoundError('Game night not found');

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

  // Generating pairings closes signups (two-phase: CLOSED → publish → PAIRED).
  if (night.status !== 'CLOSED') {
    await putNight({ ...night, status: 'CLOSED' });
  }
  return result;
}

async function notifyPaired(
  sender: EmailSender,
  opts: { to: string | undefined; playerName: string; opponentName: string; systemKey: string; night: GameNight },
): Promise<void> {
  if (!opts.to) return;
  try {
    await sender.send({
      to: opts.to,
      subject: `Your pairing for ${opts.night.title}`,
      text: `Hi ${opts.playerName}, you're paired with ${opts.opponentName} for ${opts.systemKey} at ${opts.night.title}. Good luck!`,
    });
  } catch (err) {
    console.error('Pairing notification email failed', err);
  }
}

/**
 * Publish a night's pairings: email both players of every MATCHED pairing their
 * opponent, then mark the night PAIRED. Idempotent — if the night is already
 * PAIRED, returns current state and sends nothing.
 */
export async function publishPairings(
  clubId: string,
  nightId: string,
): Promise<{ night: GameNight; pairings: Pairing[] }> {
  const night = await getNight(clubId, nightId);
  if (!night) throw new NotFoundError('Game night not found');
  const pairings = await listPairingsByNight(nightId);
  if (night.status === 'PAIRED') {
    return { night, pairings };
  }
  if (night.status !== 'CLOSED') {
    throw new ConflictError('Generate pairings before publishing');
  }

  const signups = await listSignupsByNight(nightId);
  const emailBySignupId = new Map(
    signups.filter((s) => s.status === 'CONFIRMED').map((s) => [s.signupId, s.email]),
  );
  const sender = getEmailSender();

  const sends: Promise<void>[] = [];
  for (const pairing of pairings) {
    if (pairing.status !== 'MATCHED') continue;
    if (pairing.players.length !== 2) {
      console.error('Corrupt MATCHED pairing with player count !== 2', pairing.pairingId);
      continue;
    }
    const a = pairing.players[0]!;
    const b = pairing.players[1]!;
    sends.push(notifyPaired(sender, { to: emailBySignupId.get(a.signupId), playerName: a.playerName, opponentName: b.playerName, systemKey: pairing.systemKey, night }));
    sends.push(notifyPaired(sender, { to: emailBySignupId.get(b.signupId), playerName: b.playerName, opponentName: a.playerName, systemKey: pairing.systemKey, night }));
  }
  await Promise.all(sends);

  const published: GameNight = { ...night, status: 'PAIRED' };
  await putNight(published);
  return { night: published, pairings };
}

/**
 * Resolve an odd-one-out: merge the NEEDS_RESOLUTION pairing `pairingId` with
 * another NEEDS_RESOLUTION single (the pairing whose lone player is
 * `opponentSignupId`), producing one MATCHED pairing and deleting the absorbed one.
 */
export async function resolvePairing(
  nightId: string,
  pairingId: string,
  opponentSignupId: string,
): Promise<Pairing> {
  const pairings = await listPairingsByNight(nightId);
  const target = pairings.find((p) => p.pairingId === pairingId);
  if (!target) throw new NotFoundError('Pairing not found');
  if (target.status !== 'NEEDS_RESOLUTION') throw new ConflictError('Pairing is already matched');

  const absorbed = pairings.find(
    (p) =>
      p.status === 'NEEDS_RESOLUTION' &&
      p.pairingId !== target.pairingId &&
      p.players[0]?.signupId === opponentSignupId,
  );
  if (!absorbed) {
    throw new ValidationError('opponentSignupId must be another unresolved player on this night');
  }

  // Two NEEDS_RESOLUTION singles are always from different systems (each system leaves at
  // most one odd player), so a merge is inherently cross-system; the merged pairing takes
  // the target's systemKey — the organizer's choice of which pairing to resolve into.
  const merged: Pairing = {
    ...target,
    players: [target.players[0]!, absorbed.players[0]!],
    status: 'MATCHED',
  };
  await putPairing(merged);
  // Non-atomic write-then-delete: a crash between these leaves the absorbed pairing orphaned
  // (manual cleanup needed; a retry hits the already-matched guard). Acceptable at MVP scale.
  await deletePairing(absorbed);
  return merged;
}

async function notifyOrganizerPairingsReady(clubId: string, nightId: string): Promise<void> {
  const night = await getNight(clubId, nightId);
  if (!night) return;
  const organizer = await getMembership(clubId, night.createdBy);
  if (!organizer) return;
  try {
    await getEmailSender().send({
      to: organizer.email,
      subject: `Pairings ready to review for ${night.title}`,
      text: `Pairings for ${night.title} have been generated and signups are now closed. Review them, resolve any unpaired players, and publish when ready — players are notified on publish.`,
    });
  } catch (err) {
    // Best-effort: a failed organizer notification must not fail the deadline run.
    console.error('Organizer pairings-ready email failed', err);
  }
}

/**
 * The auto-pair-at-deadline entry point (invoked by the slice-4 EventBridge schedule).
 * Generates pairings (which closes signups → CLOSED) and notifies the organizer to
 * review and publish. It deliberately does NOT publish — players are emailed only when
 * the organizer publishes.
 */
export async function runDeadlinePairing(clubId: string, nightId: string): Promise<void> {
  await generatePairings(clubId, nightId);
  await notifyOrganizerPairingsReady(clubId, nightId);
}
