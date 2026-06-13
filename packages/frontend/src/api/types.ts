import type { Club, GameNight } from '@club-night/shared';

export type ClubBranding = Club; // GET /clubs/:slug returns the Club fields
export interface NightsResponse {
  nights: GameNight[];
}
export interface NightResponse {
  night: GameNight;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
