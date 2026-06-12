import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleNight } from '../fixtures';
import { putNight, getNight, listNightsByClub } from '../../src/repositories/nights';

beforeEach(async () => {
  await resetTable();
});

describe('nights repository', () => {
  it('stores and fetches a night by club + id', async () => {
    await putNight(sampleNight());
    const night = await getNight('club-1', 'night-1');
    expect(night).not.toBeNull();
    expect(night!.title).toBe('Thursday Night Gaming');
    expect(night!.offeredSystems).toHaveLength(2);
    expect(night!.status).toBe('OPEN');
  });

  it('returns null for an unknown night', async () => {
    expect(await getNight('club-1', 'missing')).toBeNull();
  });

  it('lists all nights for a club', async () => {
    await putNight(sampleNight({ nightId: 'night-1' }));
    await putNight(sampleNight({ nightId: 'night-2', title: 'Second Night' }));
    await putNight(sampleNight({ nightId: 'other', clubId: 'club-2' }));
    const nights = await listNightsByClub('club-1');
    // DynamoDB returns query results in sort-key (SK) ascending order
    expect(nights.map((n) => n.nightId)).toEqual(['night-1', 'night-2']);
  });
});
