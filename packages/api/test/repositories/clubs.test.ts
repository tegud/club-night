import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub } from '../fixtures';
import { putClub, getClubById, getClubBySlug } from '../../src/repositories/clubs';

beforeEach(async () => {
  await resetTable();
});

describe('clubs repository', () => {
  it('stores and fetches a club by id', async () => {
    await putClub(sampleClub());
    const club = await getClubById('club-1');
    expect(club).not.toBeNull();
    expect(club!.name).toBe('Red Dice Club');
    expect(club!.enabledSystems).toEqual(['WARHAMMER_40K', 'BLOOD_BOWL']);
  });

  it('fetches a club by slug', async () => {
    await putClub(sampleClub());
    const club = await getClubBySlug('red-dice');
    expect(club!.clubId).toBe('club-1');
  });

  it('returns null for an unknown id', async () => {
    expect(await getClubById('missing')).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await getClubBySlug('missing')).toBeNull();
  });
});
