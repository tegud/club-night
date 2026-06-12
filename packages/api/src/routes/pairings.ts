import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug, requireNight } from './context';
import { requireOrganizer } from '../auth/authorize';
import { generatePairings, publishPairings, resolvePairing } from '../services/pairing-service';
import { listPairingsByNight } from '../repositories/pairings';
import { ConflictError } from '../http/errors';
import { parseOrThrow } from '../http/validate';

export const pairingRoutes = new Hono<AppEnv>();

const resolvePairingSchema = z.object({ opponentSignupId: z.string().trim().min(1) });

pairingRoutes.post('/clubs/:slug/nights/:nightId/pairings/generate', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  if (night.status === 'PAIRED') {
    throw new ConflictError('This night is already published; pairings cannot be regenerated');
  }
  const pairings = await generatePairings(club.clubId, night.nightId);
  return c.json({ pairings }, 201);
});

pairingRoutes.get('/clubs/:slug/nights/:nightId/pairings', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const pairings = await listPairingsByNight(night.nightId);
  return c.json({ pairings });
});

pairingRoutes.post('/clubs/:slug/nights/:nightId/pairings/publish', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const result = await publishPairings(club.clubId, night.nightId);
  return c.json(result);
});

pairingRoutes.patch('/clubs/:slug/nights/:nightId/pairings/:pairingId', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  if (night.status === 'PAIRED') {
    throw new ConflictError('This night is already published; pairings cannot be resolved');
  }
  const { opponentSignupId } = parseOrThrow(resolvePairingSchema, await c.req.json().catch(() => ({})));
  const pairing = await resolvePairing(night.nightId, c.req.param('pairingId'), opponentSignupId);
  return c.json({ pairing });
});
