import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { FakeEmailSender } from '../fakes/email';
import { requestGuestCode, verifyGuestCode } from '../../src/auth/guest-code-service';
import { getAuthCode } from '../../src/repositories/auth-codes';
import { verifyGuestSession } from '../../src/auth/guest-session';

beforeEach(async () => {
  await resetTable();
});

const FIXED_NOW = 1_900_000_000;

describe('requestGuestCode', () => {
  it('stores a hashed code and emails the plaintext code', async () => {
    const email = new FakeEmailSender();
    await requestGuestCode('club-1', 'Red Dice Club', 'Ada@Example.com', {
      emailSender: email,
      now: () => FIXED_NOW,
      generateCode: () => '123456',
    });

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ada@example.com');
    expect(email.sent[0]!.text).toContain('123456');

    const record = await getAuthCode('club-1', 'ada@example.com');
    expect(record).not.toBeNull();
    expect(record!.codeHash).not.toBe('123456'); // stored hashed, not plaintext
    expect(record!.ttl).toBe(FIXED_NOW + 15 * 60);
  });
});

describe('verifyGuestCode', () => {
  async function seedCode() {
    const email = new FakeEmailSender();
    await requestGuestCode('club-1', 'Red Dice Club', 'ada@example.com', {
      emailSender: email,
      now: () => FIXED_NOW,
      generateCode: () => '123456',
    });
  }

  it('returns a guest-session token for the correct code and consumes it (single use)', async () => {
    await seedCode();
    const token = await verifyGuestCode('club-1', 'Ada@Example.com', '123456', { now: () => FIXED_NOW });
    expect(token).not.toBeNull();
    expect(await verifyGuestSession(token!)).toEqual({ email: 'ada@example.com', clubId: 'club-1' });

    // single-use: the record is gone, so a second attempt fails
    expect(await verifyGuestCode('club-1', 'ada@example.com', '123456', { now: () => FIXED_NOW })).toBeNull();
  });

  it('returns null for a wrong code and leaves the record for retry', async () => {
    await seedCode();
    expect(await verifyGuestCode('club-1', 'ada@example.com', '000000', { now: () => FIXED_NOW })).toBeNull();
    expect(await getAuthCode('club-1', 'ada@example.com')).not.toBeNull();
  });

  it('returns null for an expired code and clears it', async () => {
    await seedCode();
    const later = FIXED_NOW + 16 * 60; // past the 15-minute TTL
    expect(await verifyGuestCode('club-1', 'ada@example.com', '123456', { now: () => later })).toBeNull();
    expect(await getAuthCode('club-1', 'ada@example.com')).toBeNull();
  });

  it('returns null when no code was requested', async () => {
    expect(await verifyGuestCode('club-1', 'nobody@example.com', '123456', { now: () => FIXED_NOW })).toBeNull();
  });
});
