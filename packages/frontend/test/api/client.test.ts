// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from '../../src/api/client';
import { setToken } from '../../src/auth/token';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setToken(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('apiClient', () => {
  it('GETs a club by slug', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ clubId: 'c1', slug: 'red-dice', name: 'Red Dice', logoUrl: 'l', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K'] }));
    const club = await apiClient.getClub('red-dice');
    expect(club.name).toBe('Red Dice');
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice');
  });

  it('lists nights', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ nights: [] }));
    expect(await apiClient.listNights('red-dice')).toEqual([]);
  });

  it('attaches the bearer token when present', async () => {
    setToken('tok-123');
    fetchMock.mockResolvedValueOnce(jsonResponse({ nights: [] }));
    await apiClient.listNights('red-dice');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('throws ApiError with the error code on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Club not found' } }, 404));
    await expect(apiClient.getClub('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('throws PARSE_ERROR when a 2xx body is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>nope</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    await expect(apiClient.listNights('red-dice')).rejects.toMatchObject({ code: 'PARSE_ERROR' });
  });

  it('GETs a night by id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ night: { nightId: 'n1', title: 'Thursday' } }));
    const night = await apiClient.getNight('red-dice', 'n1');
    expect(night.nightId).toBe('n1');
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice/nights/n1');
  });
});
