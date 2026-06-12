import { describe, it, expect, afterEach } from 'vitest';
import { verifyCognitoToken, setCognitoVerifier } from '../../src/auth/cognito';

afterEach(() => {
  setCognitoVerifier(undefined);
});

describe('verifyCognitoToken', () => {
  it('returns claims when the underlying verifier accepts the token', async () => {
    setCognitoVerifier({
      verify: async (token) => {
        if (token !== 'good-token') throw new Error('invalid');
        return { sub: 'user-1', email: 'olivia@example.com' };
      },
    });
    expect(await verifyCognitoToken('good-token')).toEqual({ sub: 'user-1', email: 'olivia@example.com' });
  });

  it('returns null when the underlying verifier rejects the token', async () => {
    setCognitoVerifier({
      verify: async () => {
        throw new Error('invalid');
      },
    });
    expect(await verifyCognitoToken('bad-token')).toBeNull();
  });
});
