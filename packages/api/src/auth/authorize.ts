import type { Membership } from '@club-night/shared';
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
