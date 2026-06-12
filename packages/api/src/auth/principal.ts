import { verifyGuestSession } from './guest-session';
import { verifyCognitoToken } from './cognito';

export type Principal =
  | { kind: 'guest'; email: string; clubId: string }
  | { kind: 'cognito'; userId: string; email?: string };

/** Resolve the caller from an Authorization header. Tries guest-session, then Cognito. */
export async function resolvePrincipal(authHeader: string | undefined): Promise<Principal | undefined> {
  if (!authHeader) return undefined;
  const match = /^Bearer (.+)$/.exec(authHeader.trim());
  if (!match) return undefined;
  const token = match[1]!;

  const guest = await verifyGuestSession(token);
  if (guest) return { kind: 'guest', email: guest.email, clubId: guest.clubId };

  const cognito = await verifyCognitoToken(token);
  if (cognito) {
    return cognito.email !== undefined
      ? { kind: 'cognito', userId: cognito.sub, email: cognito.email }
      : { kind: 'cognito', userId: cognito.sub };
  }

  return undefined;
}
