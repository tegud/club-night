import { SignJWT, jwtVerify } from 'jose';

export interface GuestSession {
  email: string;
  clubId: string;
}

const ALG = 'HS256';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const value = process.env.GUEST_JWT_SECRET;
  if (!value) throw new Error('GUEST_JWT_SECRET is not set');
  return new TextEncoder().encode(value);
}

export async function issueGuestSession(
  session: GuestSession,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return await new SignJWT({ email: session.email, clubId: session.clubId, tokenType: 'guest' })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(secret());
}

export async function verifyGuestSession(token: string): Promise<GuestSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    if (
      payload.tokenType !== 'guest' ||
      typeof payload.email !== 'string' ||
      typeof payload.clubId !== 'string'
    ) {
      return null;
    }
    return { email: payload.email, clubId: payload.clubId };
  } catch {
    return null;
  }
}
