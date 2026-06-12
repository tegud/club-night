import type { GameSystemKey } from './game-systems';

export const EVENT_TYPES = ['SCHEDULED_GAME_NIGHT'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const PAIRING_STRATEGIES = ['RANDOM_WITHIN_SYSTEM'] as const;
export type PairingStrategy = (typeof PAIRING_STRATEGIES)[number];

export const NIGHT_STATUSES = [
  'DRAFT',
  'OPEN',
  'CLOSED',
  'PAIRED',
  'COMPLETED',
  'CANCELLED',
] as const;
export type NightStatus = (typeof NIGHT_STATUSES)[number];

export const MEMBER_ROLES = ['OWNER', 'ORGANIZER', 'PLAYER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const SIGNUP_STATUSES = ['CONFIRMED', 'CANCELLED'] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

export const PAIRING_STATUSES = ['PUBLISHED', 'NEEDS_RESOLUTION'] as const;
export type PairingStatus = (typeof PAIRING_STATUSES)[number];

/**
 * A player's signup for a game night. Identity is either a Cognito `userId`
 * (logged-in player) or just an `email` (guest). `requestedOpponentSignupId`
 * is reserved for a future "play a specific person" feature and is unused now.
 */
export interface Signup {
  signupId: string;
  nightId: string;
  clubId: string;
  playerName: string;
  email: string;
  userId?: string;
  systemKey: GameSystemKey;
  note?: string;
  status: SignupStatus;
  requestedOpponentSignupId?: string;
}

export interface Club {
  clubId: string;
  slug: string;
  name: string;
  logoUrl: string;
  primaryColour: string;
  enabledSystems: GameSystemKey[];
}

export interface OfferedSystem {
  systemKey: GameSystemKey;
  prominent: boolean;
}

export interface GameNight {
  nightId: string;
  clubId: string;
  title: string;
  /** ISO 8601 timestamp for when the night happens. */
  eventDate: string;
  /** ISO 8601 timestamp after which signups close. */
  signupDeadline: string;
  status: NightStatus;
  eventType: EventType;
  pairingStrategy: PairingStrategy;
  offeredSystems: OfferedSystem[];
  /** userId of the organizer who created the night. */
  createdBy: string;
}
