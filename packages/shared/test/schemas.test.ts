import { describe, it, expect } from 'vitest';
import { signupInputSchema } from '../src/schemas';

const valid = {
  playerName: 'Ada',
  email: 'Ada@Example.com',
  systemKey: 'WARHAMMER_40K',
};

describe('signupInputSchema', () => {
  it('accepts valid input and normalises the email to lowercase', () => {
    const parsed = signupInputSchema.parse(valid);
    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.playerName).toBe('Ada');
    expect(parsed.systemKey).toBe('WARHAMMER_40K');
  });

  it('rejects an empty name', () => {
    expect(() => signupInputSchema.parse({ ...valid, playerName: '' })).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => signupInputSchema.parse({ ...valid, email: 'not-an-email' })).toThrow();
  });

  it('rejects an unknown game system', () => {
    expect(() => signupInputSchema.parse({ ...valid, systemKey: 'CHESS' })).toThrow();
  });

  it('accepts an optional note', () => {
    const parsed = signupInputSchema.parse({ ...valid, note: 'First time playing!' });
    expect(parsed.note).toBe('First time playing!');
  });

  it('rejects a whitespace-only playerName', () => {
    expect(() => signupInputSchema.parse({ ...valid, playerName: '   ' })).toThrow();
  });

  it('rejects a note longer than 500 characters', () => {
    expect(() => signupInputSchema.parse({ ...valid, note: 'x'.repeat(501) })).toThrow();
  });
});
