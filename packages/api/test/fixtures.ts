import type { Club, GameNight, Membership, Signup } from '@club-night/shared';

export function sampleClub(overrides: Partial<Club> = {}): Club {
  return {
    clubId: 'club-1',
    slug: 'red-dice',
    name: 'Red Dice Club',
    logoUrl: 'https://example.test/logo.png',
    primaryColour: '#B22222',
    enabledSystems: ['WARHAMMER_40K', 'BLOOD_BOWL'],
    ...overrides,
  };
}

export function sampleNight(overrides: Partial<GameNight> = {}): GameNight {
  return {
    nightId: 'night-1',
    clubId: 'club-1',
    title: 'Thursday Night Gaming',
    eventDate: '2026-07-02T18:00:00.000Z',
    signupDeadline: '2026-07-02T12:00:00.000Z',
    status: 'OPEN',
    eventType: 'SCHEDULED_GAME_NIGHT',
    pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
    offeredSystems: [
      { systemKey: 'WARHAMMER_40K', prominent: true },
      { systemKey: 'BLOOD_BOWL', prominent: false },
    ],
    createdBy: 'user-1',
    ...overrides,
  };
}

export function sampleMembership(overrides: Partial<Membership> = {}): Membership {
  return {
    clubId: 'club-1',
    userId: 'user-1',
    role: 'OWNER',
    displayName: 'Olivia Organizer',
    email: 'olivia@example.com',
    ...overrides,
  };
}

export function sampleSignup(overrides: Partial<Signup> = {}): Signup {
  return {
    signupId: 'signup-1',
    nightId: 'night-1',
    clubId: 'club-1',
    playerName: 'Ada',
    email: 'ada@example.com',
    systemKey: 'WARHAMMER_40K',
    status: 'CONFIRMED',
    ...overrides,
  };
}
