import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Club, GameNight, Signup } from '@club-night/shared';
import { updateSignupSchema } from '@club-night/shared';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug, requireNight } from './context';
import { requireSignupAccess } from '../auth/authorize';
import { NotFoundError, ValidationError, ConflictError } from '../http/errors';
import { parseOrThrow } from '../http/validate';
import { getSignup, putSignup } from '../repositories/signups';

export const signupManagementRoutes = new Hono<AppEnv>();

async function loadSignup(c: Context<AppEnv>): Promise<{ club: Club; night: GameNight; signup: Signup }> {
  const club = await requireClubBySlug(c.req.param('slug') as string);
  const night = await requireNight(club.clubId, c.req.param('nightId') as string);
  const signup = await getSignup(night.nightId, c.req.param('signupId') as string);
  if (!signup) throw new NotFoundError('Signup not found');
  return { club, night, signup };
}

signupManagementRoutes.get('/clubs/:slug/nights/:nightId/signups/:signupId', async (c) => {
  const { club, signup } = await loadSignup(c);
  await requireSignupAccess(c.get('principal'), club, signup);
  return c.json({ signup });
});

signupManagementRoutes.patch('/clubs/:slug/nights/:nightId/signups/:signupId', async (c) => {
  const { club, night, signup } = await loadSignup(c);
  await requireSignupAccess(c.get('principal'), club, signup);
  if (signup.status === 'CANCELLED') {
    throw new ConflictError('Cannot update a cancelled signup');
  }
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    throw new ValidationError('Request body must be valid JSON');
  }
  const input = parseOrThrow(updateSignupSchema, rawBody);
  if (input.systemKey && !night.offeredSystems.some((s) => s.systemKey === input.systemKey)) {
    throw new ValidationError(`System ${input.systemKey} is not offered on this night`);
  }
  const updated: Signup = { ...signup, ...input };
  await putSignup(updated);
  return c.json({ signup: updated });
});

signupManagementRoutes.delete('/clubs/:slug/nights/:nightId/signups/:signupId', async (c) => {
  const { club, signup } = await loadSignup(c);
  await requireSignupAccess(c.get('principal'), club, signup);
  const cancelled: Signup = { ...signup, status: 'CANCELLED' };
  await putSignup(cancelled);
  return c.json({ signup: cancelled });
});
