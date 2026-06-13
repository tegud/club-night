import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
});

describe('CORS', () => {
  it('answers a preflight OPTIONS with permissive CORS headers', async () => {
    const res = await createApp().request('/clubs/red-dice', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('adds the allow-origin header to a normal response', async () => {
    const res = await createApp().request('/clubs/missing', { headers: { origin: 'https://app.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
