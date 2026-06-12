import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleMembership } from '../fixtures';
import { putMembership, getMembership } from '../../src/repositories/memberships';

beforeEach(async () => {
  await resetTable();
});

describe('memberships repository', () => {
  it('stores and fetches a membership by club + user', async () => {
    await putMembership(sampleMembership());
    const m = await getMembership('club-1', 'user-1');
    expect(m).not.toBeNull();
    expect(m!.role).toBe('OWNER');
    expect(m!.displayName).toBe('Olivia Organizer');
  });

  it('returns null when the user is not a member of the club', async () => {
    await putMembership(sampleMembership());
    expect(await getMembership('club-1', 'someone-else')).toBeNull();
    expect(await getMembership('club-2', 'user-1')).toBeNull();
  });
});
