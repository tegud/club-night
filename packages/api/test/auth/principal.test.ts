import { describe, it, expect, afterEach } from 'vitest';
import { resolvePrincipal } from '../../src/auth/principal';
import { issueGuestSession } from '../../src/auth/guest-session';
import { setCognitoVerifier } from '../../src/auth/cognito';

afterEach(() => {
  setCognitoVerifier(undefined);
});

describe('resolvePrincipal', () => {
  it('returns undefined when there is no Authorization header', async () => {
    expect(await resolvePrincipal(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-Bearer header', async () => {
    expect(await resolvePrincipal('Basic abc')).toBeUndefined();
  });

  it('resolves a guest principal from a guest-session token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    expect(await resolvePrincipal(`Bearer ${token}`)).toEqual({
      kind: 'guest',
      email: 'ada@example.com',
      clubId: 'club-1',
    });
  });

  it('resolves a cognito principal when the cognito verifier accepts the token', async () => {
    setCognitoVerifier({
      verify: async () => ({ sub: 'user-1', email: 'olivia@example.com' }),
    });
    expect(await resolvePrincipal('Bearer cognito-token')).toEqual({
      kind: 'cognito',
      userId: 'user-1',
      email: 'olivia@example.com',
    });
  });

  it('returns undefined when the token is neither a valid guest nor cognito token', async () => {
    setCognitoVerifier({
      verify: async () => {
        throw new Error('invalid');
      },
    });
    expect(await resolvePrincipal('Bearer garbage')).toBeUndefined();
  });

  it('omits email for a cognito token without an email claim', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'user-1' }) });
    expect(await resolvePrincipal('Bearer cognito-token')).toEqual({ kind: 'cognito', userId: 'user-1' });
  });
});
