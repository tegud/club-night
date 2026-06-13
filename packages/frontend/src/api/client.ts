import { API_BASE_URL } from '../config';
import { getToken, setToken } from '../auth/token';
import type { ClubBranding, NightResponse, NightsResponse, ApiErrorBody, PairingsResponse, PairingResponse, PublishResponse } from './types';
import type { Signup, SignupInput, UpdateSignupInput, CreateNightInput, UpdateNightInput, GameNight, Pairing } from '@club-night/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body as ApiErrorBody | undefined)?.error;
    const message = err?.message || res.statusText || `HTTP ${res.status}`;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', message);
  }
  if (body === undefined && res.status !== 204) {
    throw new ApiError(res.status, 'PARSE_ERROR', 'Response body could not be parsed');
  }
  return body as T;
}

export const apiClient = {
  getClub(slug: string): Promise<ClubBranding> {
    return request<ClubBranding>(`/clubs/${encodeURIComponent(slug)}`);
  },
  async listNights(slug: string) {
    const res = await request<NightsResponse>(`/clubs/${encodeURIComponent(slug)}/nights`);
    return res.nights;
  },
  async getNight(slug: string, nightId: string) {
    const res = await request<NightResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}`);
    return res.night;
  },
  async createSignup(slug: string, nightId: string, input: SignupInput): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return res.signup;
  },
  async requestGuestCode(slug: string, email: string): Promise<void> {
    await request<{ ok: boolean }>(`/clubs/${encodeURIComponent(slug)}/guest/request-code`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
  async verifyGuestCode(slug: string, email: string, code: string): Promise<void> {
    const res = await request<{ token: string }>(`/clubs/${encodeURIComponent(slug)}/guest/verify-code`, {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    setToken(res.token);
  },
  async getMySignup(slug: string, nightId: string): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/my-signup`,
    );
    return res.signup;
  },
  async updateSignup(slug: string, nightId: string, signupId: string, input: UpdateSignupInput): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups/${encodeURIComponent(signupId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
    return res.signup;
  },
  async withdrawSignup(slug: string, nightId: string, signupId: string): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups/${encodeURIComponent(signupId)}`,
      { method: 'DELETE' },
    );
    return res.signup;
  },
  async createNight(slug: string, input: CreateNightInput): Promise<GameNight> {
    const res = await request<{ night: GameNight }>(`/clubs/${encodeURIComponent(slug)}/nights`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.night;
  },
  async updateNight(slug: string, nightId: string, input: UpdateNightInput): Promise<GameNight> {
    const res = await request<{ night: GameNight }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
    return res.night;
  },
  async listNightSignups(slug: string, nightId: string): Promise<Signup[]> {
    const res = await request<{ signups: Signup[] }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups`,
    );
    return res.signups;
  },
  async listPairings(slug: string, nightId: string): Promise<Pairing[]> {
    const res = await request<PairingsResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings`);
    return res.pairings;
  },
  async generatePairings(slug: string, nightId: string): Promise<Pairing[]> {
    const res = await request<PairingsResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings/generate`, { method: 'POST' });
    return res.pairings;
  },
  async resolvePairing(slug: string, nightId: string, pairingId: string, opponentSignupId: string): Promise<Pairing> {
    const res = await request<PairingResponse>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings/${encodeURIComponent(pairingId)}`,
      { method: 'PATCH', body: JSON.stringify({ opponentSignupId }) },
    );
    return res.pairing;
  },
  async publishPairings(slug: string, nightId: string): Promise<PublishResponse> {
    return request<PublishResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings/publish`, { method: 'POST' });
  },
};
