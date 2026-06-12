import { describe, it, expect } from 'vitest';
import { generateNumericCode, hashGuestCode } from '../../src/auth/code';

describe('generateNumericCode', () => {
  it('returns a 6-digit numeric string by default', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateNumericCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashGuestCode', () => {
  it('is deterministic for the same club, email and code', () => {
    const a = hashGuestCode('club-1', 'ada@example.com', '123456');
    const b = hashGuestCode('club-1', 'ada@example.com', '123456');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when the code, email or club differ', () => {
    const base = hashGuestCode('club-1', 'ada@example.com', '123456');
    expect(hashGuestCode('club-1', 'ada@example.com', '654321')).not.toBe(base);
    expect(hashGuestCode('club-1', 'bob@example.com', '123456')).not.toBe(base);
    expect(hashGuestCode('club-2', 'ada@example.com', '123456')).not.toBe(base);
  });
});
