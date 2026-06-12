import { Hono } from 'hono';
import { requireClubBySlug, requireNight } from './context';
import { listNightsByClub } from '../repositories/nights';

export const nightRoutes = new Hono();

nightRoutes.get('/clubs/:slug/nights', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const nights = await listNightsByClub(club.clubId);
  const visible = nights
    .filter((n) => n.status !== 'CANCELLED')
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  return c.json({ nights: visible });
});

nightRoutes.get('/clubs/:slug/nights/:nightId', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  return c.json({ night });
});
