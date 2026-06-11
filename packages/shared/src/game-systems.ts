export const GAME_SYSTEM_KEYS = [
  'WARHAMMER_40K',
  'AGE_OF_SIGMAR',
  'BLOOD_BOWL',
  'HORUS_HERESY',
] as const;

export type GameSystemKey = (typeof GAME_SYSTEM_KEYS)[number];

export const GAME_SYSTEM_NAMES: Record<GameSystemKey, string> = {
  WARHAMMER_40K: 'Warhammer 40,000',
  AGE_OF_SIGMAR: 'Age of Sigmar',
  BLOOD_BOWL: 'Blood Bowl',
  HORUS_HERESY: 'Horus Heresy',
};

export const GAME_SYSTEMS = GAME_SYSTEM_KEYS.map((key) => ({
  key,
  name: GAME_SYSTEM_NAMES[key],
})) satisfies ReadonlyArray<{ key: GameSystemKey; name: string }>;

export function isGameSystemKey(value: string): value is GameSystemKey {
  return (GAME_SYSTEM_KEYS as readonly string[]).includes(value);
}
