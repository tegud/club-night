import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug, requireNight } from './context';
import { requireOrganizer } from '../auth/authorize';
import { generatePairings } from '../services/pairing-service';
import { listPairingsByNight } from '../repositories/pairings';

export const pairingRoutes = new Hono<AppEnv>();

pairingRoutes.post('/clubs/:slug/nights/:nightId/pairings/generate', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
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
