import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { putAuthCode, getAuthCode, deleteAuthCode } from '../../src/repositories/auth-codes';

beforeEach(async () => {
  await resetTable();
});

const rec = {
  clubId: 'club-1',
  email: 'ada@example.com',
  codeHash: 'abc123',
  ttl: 1_900_000_000,
};

describe('auth-codes repository', () => {
  it('stores and fetches a code record by club + email', async () => {
    await putAuthCode(rec);
    const found = await getAuthCode('club-1', 'ada@example.com');
    expect(found).toEqual(rec);
  });

  it('returns null when there is no code for that club + email', async () => {
    expect(await getAuthCode('club-1', 'nobody@example.com')).toBeNull();
  });

  it('overwrites a previous code for the same club + email', async () => {
    await putAuthCode(rec);
    await putAuthCode({ ...rec, codeHash: 'newhash' });
    const found = await getAuthCode('club-1', 'ada@example.com');
    expect(found!.codeHash).toBe('newhash');
  });

  it('deletes a code record', async () => {
    await putAuthCode(rec);
    await deleteAuthCode('club-1', 'ada@example.com');
    expect(await getAuthCode('club-1', 'ada@example.com')).toBeNull();
  });

  it('normalises email case so a mixed-case put is found by a lowercase get', async () => {
    await putAuthCode({ ...rec, email: 'Ada@Example.COM' });
    const found = await getAuthCode('club-1', 'ada@example.com');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('ada@example.com');
  });
});
