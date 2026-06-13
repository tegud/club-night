import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { onError } from './http/error-handler';
import { authMiddleware, type AppEnv } from './auth/middleware';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';
import { signupRoutes } from './routes/signups';
import { guestRoutes } from './routes/guest';
import { organizerNightRoutes } from './routes/organizer-nights';
import { signupManagementRoutes } from './routes/signup-management';
import { pairingRoutes } from './routes/pairings';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );

  app.use('*', authMiddleware);

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);
  app.route('/', signupRoutes);
  app.route('/', guestRoutes);
  app.route('/', organizerNightRoutes);
  app.route('/', signupManagementRoutes);
  app.route('/', pairingRoutes);

  return app;
}
