import { createMiddleware } from 'hono/factory';
import { resolvePrincipal, type Principal } from './principal';

export type AppEnv = { Variables: { principal?: Principal } };

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await resolvePrincipal(c.req.header('authorization'));
  c.set('principal', principal);
  await next();
});
