import type { Club, GameNight, Pairing } from '@club-night/shared';

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
export interface PairingsResponse {
  pairings: Pairing[];
}
export interface PairingResponse {
  pairing: Pairing;
}
export interface PublishResponse {
  night: GameNight;
  pairings: Pairing[];
}
