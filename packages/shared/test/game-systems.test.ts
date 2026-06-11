import { describe, it, expect } from 'vitest';
import { GAME_SYSTEM_KEYS, GAME_SYSTEMS, isGameSystemKey } from '../src/game-systems';

describe('game systems catalogue', () => {
  it('lists the four MVP systems in order', () => {
    expect(GAME_SYSTEM_KEYS).toEqual([
      'WARHAMMER_40K',
      'AGE_OF_SIGMAR',
      'BLOOD_BOWL',
      'HORUS_HERESY',
    ]);
  });

  it('gives every system a non-empty display name', () => {
    expect(GAME_SYSTEMS).toHaveLength(4);
    expect(GAME_SYSTEMS[0]!.name).toBe('Warhammer 40,000');
    for (const system of GAME_SYSTEMS) {
      expect(system.name.length).toBeGreaterThan(0);
    }
  });

  it('recognises valid keys and rejects unknown ones', () => {
    expect(isGameSystemKey('WARHAMMER_40K')).toBe(true);
    expect(isGameSystemKey('CHESS')).toBe(false);
  });
});
