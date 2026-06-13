// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from '../../src/api/client';
import { setToken, getToken } from '../../src/auth/token';

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

  it('POSTs a signup and returns the created signup', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', playerName: 'Ada', systemKey: 'WARHAMMER_40K', status: 'CONFIRMED' } }, 201));
    const signup = await apiClient.createSignup('red-dice', 'n1', { playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K' });
    expect(signup.signupId).toBe('s1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/clubs/red-dice/nights/n1/signups');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K' });
  });

  it('surfaces a 409 (night not open) as an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'CONFLICT', message: 'This game night is not open for signups' } }, 409));
    await expect(
      apiClient.createSignup('red-dice', 'n1', { playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('requestGuestCode POSTs the email', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiClient.requestGuestCode('red-dice', 'ada@example.com');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/clubs/red-dice/guest/request-code');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: 'ada@example.com' });
  });

  it('verifyGuestCode stores the returned token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: 'guest-tok' }));
    await apiClient.verifyGuestCode('red-dice', 'ada@example.com', '123456');
    expect(getToken()).toBe('guest-tok');
  });

  it('getMySignup GETs the my-signup endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', email: 'ada@example.com', systemKey: 'WARHAMMER_40K', status: 'CONFIRMED' } }));
    const s = await apiClient.getMySignup('red-dice', 'n1');
    expect(s.signupId).toBe('s1');
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice/nights/n1/my-signup');
  });

  it('updateSignup sends a PATCH', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', systemKey: 'BLOOD_BOWL', status: 'CONFIRMED' } }));
    await apiClient.updateSignup('red-dice', 'n1', 's1', { systemKey: 'BLOOD_BOWL' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
  });

  it('withdrawSignup sends a DELETE and returns the cancelled signup', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', status: 'CANCELLED' } }));
    const cancelled = await apiClient.withdrawSignup('red-dice', 'n1', 's1');
    expect(cancelled.status).toBe('CANCELLED');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('DELETE');
  });

  it('createNight POSTs and returns the night', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ night: { nightId: 'n1', title: 'Thu', status: 'OPEN' } }, 201));
    const night = await apiClient.createNight('red-dice', { title: 'Thu', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }] });
    expect(night.nightId).toBe('n1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/clubs\/red-dice\/nights$/);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ title: 'Thu', eventDate: '2026-07-02T18:00:00.000Z' });
  });

  it('updateNight PATCHes the night', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ night: { nightId: 'n1', status: 'CANCELLED' } }));
    const night = await apiClient.updateNight('red-dice', 'n1', { status: 'CANCELLED' });
    expect(night.status).toBe('CANCELLED');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ status: 'CANCELLED' });
  });

  it('listNightSignups GETs the night signups', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signups: [{ signupId: 's1', playerName: 'Ada' }] }));
    const signups = await apiClient.listNightSignups('red-dice', 'n1');
    expect(signups).toHaveLength(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice/nights/n1/signups');
  });
});
