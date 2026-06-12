import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface CognitoClaims {
  sub: string;
  email?: string;
}

export interface CognitoTokenVerifier {
  verify(token: string): Promise<CognitoClaims>;
}

let override: CognitoTokenVerifier | undefined;
let real: CognitoTokenVerifier | undefined;

/** Override the Cognito verifier (used by tests). Pass undefined to reset. */
export function setCognitoVerifier(next: CognitoTokenVerifier | undefined): void {
  override = next;
}

function realVerifier(): CognitoTokenVerifier {
  if (!real) {
    const verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
      clientId: process.env.COGNITO_CLIENT_ID ?? '',
      tokenUse: 'id',
    });
    real = {
      async verify(token) {
        const payload = await verifier.verify(token);
        return {
          sub: String(payload.sub),
          email: typeof payload.email === 'string' ? payload.email : undefined,
        };
      },
    };
  }
  return real;
}

/** Verify a Cognito ID token; returns its claims, or null if invalid. */
export async function verifyCognitoToken(token: string): Promise<CognitoClaims | null> {
  try {
    return await (override ?? realVerifier()).verify(token);
  } catch {
    return null;
  }
}
