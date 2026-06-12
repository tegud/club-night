import { Hono } from 'hono';
import { ulid } from 'ulid';
import { createNightSchema, updateNightSchema } from '@club-night/shared';
import type { Club, GameNight, GameSystemKey } from '@club-night/shared';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug, requireNight } from './context';
import { requireOrganizer } from '../auth/authorize';
import { parseOrThrow } from '../http/validate';
import { ValidationError } from '../http/errors';
import { putNight } from '../repositories/nights';
import { listSignupsByNight } from '../repositories/signups';

function assertSystemsEnabled(club: Club, offeredSystems: { systemKey: GameSystemKey }[]): void {
  for (const offered of offeredSystems) {
    if (!club.enabledSystems.includes(offered.systemKey)) {
      throw new ValidationError(`System ${offered.systemKey} is not enabled for this club`);
    }
  }
}

export const organizerNightRoutes = new Hono<AppEnv>();

organizerNightRoutes.post('/clubs/:slug/nights', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const membership = await requireOrganizer(c.get('principal'), club.clubId);
  const input = parseOrThrow(createNightSchema, await c.req.json().catch(() => ({})));

  assertSystemsEnabled(club, input.offeredSystems);

  const night: GameNight = {
    nightId: ulid(),
    clubId: club.clubId,
    title: input.title,
    eventDate: input.eventDate,
    signupDeadline: input.signupDeadline,
    status: 'OPEN',
    eventType: 'SCHEDULED_GAME_NIGHT',
    pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
    offeredSystems: input.offeredSystems,
    createdBy: membership.userId,
  };
  await putNight(night);
  return c.json({ night }, 201);
});

organizerNightRoutes.patch('/clubs/:slug/nights/:nightId', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const input = parseOrThrow(updateNightSchema, await c.req.json().catch(() => ({})));

  if (input.offeredSystems) assertSystemsEnabled(club, input.offeredSystems);

  const updated: GameNight = { ...night, ...input };
  await putNight(updated);
  return c.json({ night: updated });
});

organizerNightRoutes.get('/clubs/:slug/nights/:nightId/signups', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const signups = await listSignupsByNight(night.nightId);
  return c.json({ signups });
});
