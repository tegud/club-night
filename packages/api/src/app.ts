import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';
import { signupRoutes } from './routes/signups';

export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);
  app.route('/', signupRoutes);

  return app;
}
