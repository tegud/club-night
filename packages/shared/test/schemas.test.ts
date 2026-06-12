import { describe, it, expect } from 'vitest';
import { signupInputSchema, createNightSchema, updateNightSchema, updateSignupSchema } from '../src/schemas';

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

describe('createNightSchema', () => {
  const valid = {
    title: 'Thursday Night',
    eventDate: '2026-07-02T18:00:00.000Z',
    signupDeadline: '2026-07-02T12:00:00.000Z',
    offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }],
  };

  it('accepts valid input', () => {
    expect(createNightSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty title', () => {
    expect(() => createNightSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('rejects a non-ISO eventDate', () => {
    expect(() => createNightSchema.parse({ ...valid, eventDate: 'next thursday' })).toThrow();
  });

  it('rejects an empty offeredSystems list', () => {
    expect(() => createNightSchema.parse({ ...valid, offeredSystems: [] })).toThrow();
  });

  it('rejects an unknown system key', () => {
    expect(() =>
      createNightSchema.parse({ ...valid, offeredSystems: [{ systemKey: 'CHESS', prominent: true }] }),
    ).toThrow();
  });
});

describe('updateNightSchema', () => {
  it('accepts a partial update', () => {
    expect(updateNightSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('accepts a status change', () => {
    expect(updateNightSchema.parse({ status: 'CANCELLED' })).toEqual({ status: 'CANCELLED' });
  });

  it('rejects an unknown status', () => {
    expect(() => updateNightSchema.parse({ status: 'NOPE' })).toThrow();
  });

  it('rejects an empty offeredSystems array', () => {
    expect(() => updateNightSchema.parse({ offeredSystems: [] })).toThrow();
  });
});

describe('updateSignupSchema', () => {
  it('accepts a system change', () => {
    expect(updateSignupSchema.parse({ systemKey: 'BLOOD_BOWL' })).toEqual({ systemKey: 'BLOOD_BOWL' });
  });

  it('accepts a note change', () => {
    expect(updateSignupSchema.parse({ note: 'Bringing Orks' })).toEqual({ note: 'Bringing Orks' });
  });

  it('accepts an empty (no-op) update', () => {
    expect(updateSignupSchema.parse({})).toEqual({});
  });

  it('rejects an unknown system', () => {
    expect(() => updateSignupSchema.parse({ systemKey: 'CHESS' })).toThrow();
  });
});
