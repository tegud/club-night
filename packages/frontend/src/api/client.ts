import { API_BASE_URL } from '../config';
import { getToken } from '../auth/token';
import type { ClubBranding, NightResponse, NightsResponse, ApiErrorBody } from './types';

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
};
