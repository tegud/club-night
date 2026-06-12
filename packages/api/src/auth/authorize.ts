import type { Club, Membership, Signup } from '@club-night/shared';
import type { Principal } from './principal';
import { getMembership } from '../repositories/memberships';
import { ForbiddenError, UnauthorizedError } from '../http/errors';

/**
 * Require that the principal is a Cognito user who is an OWNER or ORGANIZER of the club.
 * Returns their membership. Throws Unauthorized (no/!cognito principal) or Forbidden
 * (not an organizing member).
 */
export async function requireOrganizer(
  principal: Principal | undefined,
  clubId: string,
): Promise<Membership> {
  if (!principal || principal.kind !== 'cognito') {
    throw new UnauthorizedError('Organizer sign-in required');
  }
  const membership = await getMembership(clubId, principal.userId);
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ORGANIZER')) {
    throw new ForbiddenError('You are not an organizer of this club');
  }
  return membership;
}

/**
 * Require that the principal may manage this signup: the guest who owns it
 * (email + club match), the logged-in player who owns it (userId match), or an
 * organizer of the club. Throws Unauthorized (no principal) or Forbidden.
 */
export async function requireSignupAccess(
  principal: Principal | undefined,
  club: Club,
  signup: Signup,
): Promise<void> {
  if (!principal) throw new UnauthorizedError('Sign-in required');

  if (principal.kind === 'guest') {
    // Guest sessions are club-scoped (email + clubId), not night-scoped: a guest may
    // manage their own signups on any night within the club they verified.
    if (principal.clubId === club.clubId && principal.email === signup.email) return;
    throw new ForbiddenError('You can only manage your own signup');
  }

  // cognito: owner by userId, otherwise must be an organizer of the club
  if (signup.userId && signup.userId === principal.userId) return;
  await requireOrganizer(principal, club.clubId);
}
