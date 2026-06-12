import { Hono } from 'hono';
import { requireClubBySlug } from './context';

export const clubRoutes = new Hono();

clubRoutes.get('/clubs/:slug', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  return c.json(club);
});
