import { describe, it, expect } from 'vitest';
import {
  NIGHT_STATUSES,
  SIGNUP_STATUSES,
  PAIRING_STATUSES,
  MEMBER_ROLES,
  EVENT_TYPES,
  PAIRING_STRATEGIES,
} from '../src/domain';

describe('domain constants', () => {
  it('defines the night lifecycle statuses', () => {
    expect(NIGHT_STATUSES).toEqual([
      'DRAFT',
      'OPEN',
      'CLOSED',
      'PAIRED',
      'COMPLETED',
      'CANCELLED',
    ]);
  });

  it('defines signup statuses', () => {
    expect(SIGNUP_STATUSES).toEqual(['CONFIRMED', 'CANCELLED']);
  });

  it('defines pairing statuses', () => {
    expect(PAIRING_STATUSES).toEqual(['PUBLISHED', 'NEEDS_RESOLUTION']);
  });

  it('defines member roles', () => {
    expect(MEMBER_ROLES).toEqual(['OWNER', 'ORGANIZER', 'PLAYER']);
  });

  it('defines the MVP event type and pairing strategy', () => {
    expect(EVENT_TYPES).toEqual(['SCHEDULED_GAME_NIGHT']);
    expect(PAIRING_STRATEGIES).toEqual(['RANDOM_WITHIN_SYSTEM']);
  });
});
