import { Hono } from 'hono';
import { z } from 'zod';
import { requireClubBySlug } from './context';
import { parseOrThrow } from '../http/validate';
import { UnauthorizedError } from '../http/errors';
import { getEmailSender } from '../email/provider';
import { requestGuestCode, verifyGuestCode } from '../auth/guest-code-service';

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().min(1),
});

export const guestRoutes = new Hono();

guestRoutes.post('/clubs/:slug/guest/request-code', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const { email } = parseOrThrow(requestSchema, await c.req.json().catch(() => ({})));
  await requestGuestCode(club.clubId, club.name, email, { emailSender: getEmailSender() });
  // Always 200 — never reveal whether the email already has a signup.
  return c.json({ ok: true });
});

guestRoutes.post('/clubs/:slug/guest/verify-code', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const { email, code } = parseOrThrow(verifySchema, await c.req.json().catch(() => ({})));
  const token = await verifyGuestCode(club.clubId, email, code);
  if (!token) throw new UnauthorizedError('Invalid or expired code');
  return c.json({ token });
});
