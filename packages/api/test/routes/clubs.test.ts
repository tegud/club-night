import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
});

describe('GET /clubs/:slug', () => {
  it('returns branding for an existing club', async () => {
    await putClub(sampleClub());
    const res = await createApp().request('/clubs/red-dice');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      clubId: 'club-1',
      slug: 'red-dice',
      name: 'Red Dice Club',
      logoUrl: 'https://example.test/logo.png',
      primaryColour: '#B22222',
      enabledSystems: ['WARHAMMER_40K', 'BLOOD_BOWL'],
    });
  });

  it('404s for an unknown slug', async () => {
    const res = await createApp().request('/clubs/missing');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error.code).toBe('NOT_FOUND');
  });
});
