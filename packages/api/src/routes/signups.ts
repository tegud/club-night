import { Hono } from 'hono';
import { signupInputSchema } from '@club-night/shared';
import { requireClubBySlug, requireNight } from './context';
import { upsertSignup } from '../repositories/signups';
import { ConflictError, ValidationError } from '../http/errors';
import { parseOrThrow } from '../http/validate';

export const signupRoutes = new Hono();

signupRoutes.post('/clubs/:slug/nights/:nightId/signups', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  if (night.status !== 'OPEN') {
    throw new ConflictError('This game night is not open for signups');
  }

  const raw = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(signupInputSchema, raw);

  if (!night.offeredSystems.some((s) => s.systemKey === input.systemKey)) {
    throw new ValidationError(`System ${input.systemKey} is not offered on this night`);
  }

  const signup = await upsertSignup({
    nightId: night.nightId,
    clubId: club.clubId,
    playerName: input.playerName,
    email: input.email,
    systemKey: input.systemKey,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });

  return c.json({ signup }, 201);
});
