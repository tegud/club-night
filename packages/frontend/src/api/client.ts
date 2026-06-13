import { API_BASE_URL } from '../config';
import { getToken, setToken } from '../auth/token';
import type { ClubBranding, NightResponse, NightsResponse, ApiErrorBody } from './types';
import type { Signup, SignupInput, UpdateSignupInput } from '@club-night/shared';

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
};
