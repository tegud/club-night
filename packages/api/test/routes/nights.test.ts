import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
});

describe('GET /clubs/:slug/nights', () => {
  it('lists non-cancelled nights sorted by event date', async () => {
    await putNight(sampleNight({ nightId: 'n-late', eventDate: '2026-08-01T18:00:00.000Z' }));
    await putNight(sampleNight({ nightId: 'n-early', eventDate: '2026-07-01T18:00:00.000Z' }));
    await putNight(sampleNight({ nightId: 'n-cancelled', status: 'CANCELLED' }));

    const res = await createApp().request('/clubs/red-dice/nights');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.nights.map((n: { nightId: string }) => n.nightId)).toEqual(['n-early', 'n-late']);
  });

  it('404s when the club does not exist', async () => {
    const res = await createApp().request('/clubs/missing/nights');
    expect(res.status).toBe(404);
  });
});

describe('GET /clubs/:slug/nights/:nightId', () => {
  it('returns a single night', async () => {
    await putNight(sampleNight({ nightId: 'night-1' }));
    const res = await createApp().request('/clubs/red-dice/nights/night-1');
    expect(res.status).toBe(200);
    expect((await res.json() as any).night.title).toBe('Thursday Night Gaming');
  });

  it('404s for an unknown night', async () => {
    const res = await createApp().request('/clubs/red-dice/nights/missing');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});
