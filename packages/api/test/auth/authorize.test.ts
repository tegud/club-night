import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleMembership, sampleClub, sampleSignup } from '../fixtures';
import { putMembership } from '../../src/repositories/memberships';
import { requireOrganizer, requireSignupAccess } from '../../src/auth/authorize';
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

describe('requireSignupAccess', () => {
  const club = sampleClub(); // clubId 'club-1'
  const signup = sampleSignup(); // clubId 'club-1', email 'ada@example.com', no userId

  it('allows the guest who owns the signup (email + club match)', async () => {
    const guest: Principal = { kind: 'guest', email: 'ada@example.com', clubId: 'club-1' };
    await expect(requireSignupAccess(guest, club, signup)).resolves.toBeUndefined();
  });

  it('forbids a guest of the right club with a different email', async () => {
    const guest: Principal = { kind: 'guest', email: 'bob@example.com', clubId: 'club-1' };
    await expect(requireSignupAccess(guest, club, signup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forbids a guest whose session is for a different club', async () => {
    const guest: Principal = { kind: 'guest', email: 'ada@example.com', clubId: 'club-2' };
    await expect(requireSignupAccess(guest, club, signup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows a logged-in player who owns the signup (userId match)', async () => {
    const owned = sampleSignup({ userId: 'user-9' });
    const principal: Principal = { kind: 'cognito', userId: 'user-9' };
    await expect(requireSignupAccess(principal, club, owned)).resolves.toBeUndefined();
  });

  it('allows an organizer to manage any signup in their club', async () => {
    await putMembership(sampleMembership({ userId: 'org-1', role: 'ORGANIZER' }));
    const principal: Principal = { kind: 'cognito', userId: 'org-1' };
    await expect(requireSignupAccess(principal, club, signup)).resolves.toBeUndefined();
  });

  it('forbids a cognito user who is neither the owner nor an organizer', async () => {
    const principal: Principal = { kind: 'cognito', userId: 'stranger' };
    await expect(requireSignupAccess(principal, club, signup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws Unauthorized when there is no principal', async () => {
    await expect(requireSignupAccess(undefined, club, signup)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
