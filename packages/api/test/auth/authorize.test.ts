import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleMembership } from '../fixtures';
import { putMembership } from '../../src/repositories/memberships';
import { requireOrganizer } from '../../src/auth/authorize';
import { ForbiddenError, UnauthorizedError } from '../../src/http/errors';
import type { Principal } from '../../src/auth/principal';

beforeEach(async () => {
  await resetTable();
});

const cognito = (userId: string): Principal => ({ kind: 'cognito', userId, email: 'o@example.com' });

describe('requireOrganizer', () => {
  it('returns the membership for an OWNER', async () => {
    await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
    const m = await requireOrganizer(cognito('user-1'), 'club-1');
    expect(m.role).toBe('OWNER');
  });

  it('allows an ORGANIZER', async () => {
    await putMembership(sampleMembership({ userId: 'user-2', role: 'ORGANIZER' }));
    const m = await requireOrganizer(cognito('user-2'), 'club-1');
    expect(m.role).toBe('ORGANIZER');
  });

  it('throws Forbidden for a PLAYER member', async () => {
    await putMembership(sampleMembership({ userId: 'user-3', role: 'PLAYER' }));
    await expect(requireOrganizer(cognito('user-3'), 'club-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws Forbidden when the user has no membership of the club', async () => {
    await expect(requireOrganizer(cognito('stranger'), 'club-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws Unauthorized when there is no principal', async () => {
    await expect(requireOrganizer(undefined, 'club-1')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws Unauthorized for a guest principal', async () => {
    const guest: Principal = { kind: 'guest', email: 'a@b.com', clubId: 'club-1' };
    await expect(requireOrganizer(guest, 'club-1')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
