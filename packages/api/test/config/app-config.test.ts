import { describe, it, expect } from 'vitest';
import { assertAppConfig } from '../../src/config/app-config';

const complete = {
  GUEST_JWT_SECRET: 'x'.repeat(40),
  EMAIL_FROM: 'no-reply@club.test',
  COGNITO_USER_POOL_ID: 'pool',
  COGNITO_CLIENT_ID: 'client',
  CLUB_NIGHT_TABLE: 'club-night',
};

describe('assertAppConfig', () => {
  it('passes when all required vars are present', () => {
    expect(() => assertAppConfig(complete)).not.toThrow();
  });

  it('throws listing every missing required var', () => {
    try {
      assertAppConfig({ CLUB_NIGHT_TABLE: 'club-night' });
      throw new Error('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('GUEST_JWT_SECRET');
      expect(message).toContain('EMAIL_FROM');
      expect(message).toContain('COGNITO_USER_POOL_ID');
      expect(message).toContain('COGNITO_CLIENT_ID');
      expect(message).not.toContain('CLUB_NIGHT_TABLE');
    }
  });
});
