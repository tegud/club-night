# Foundation & Pairing Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Club Night monorepo and build the two zero-dependency foundations every later slice relies on: the `shared` package (game-system catalogue, domain types, request validation) and the pure-function pairing engine.

**Architecture:** An npm-workspaces monorepo with `packages/shared` (types, zod schemas, game-system catalogue) and `packages/api` (which in this slice holds only the pure pairing engine — no Lambda/Hono yet). Everything is plain TypeScript with no AWS dependencies, tested with Vitest. The pairing engine takes an injectable shuffle so its randomness is deterministic under test.

**Tech Stack:** TypeScript 5, npm workspaces, Vitest, zod.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md`

> **Commit note:** This plan follows TDD with frequent commits as discrete steps. The repo owner prefers to control commits — when executing, treat the commit steps as the owner's call to run (or batch) rather than auto-committing without their go-ahead.

---

## File structure produced by this plan

```
club-night/
  package.json                          workspace root, scripts, dev deps
  tsconfig.base.json                    shared compiler options
  vitest.config.ts                      test discovery across packages
  .gitignore
  packages/
    shared/
      package.json
      tsconfig.json
      src/
        index.ts                        barrel re-export
        game-systems.ts                 catalogue + GameSystemKey + guard
        domain.ts                       status constants + Signup type
        schemas.ts                      zod request schemas (signup input)
      test/
        game-systems.test.ts
        domain.test.ts
        schemas.test.ts
    api/
      package.json
      tsconfig.json
      src/
        domain/
          pairing.ts                    fisherYatesShuffle + pairNight
      test/
        pairing.test.ts
```

---

## Task 1: Initialize the monorepo root

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Create the root `package.json`**

```json
{
  "name": "club-night",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```gitignore
node_modules/
dist/
coverage/
*.log
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: completes without errors; creates `node_modules/` and `package-lock.json`. (Workspaces `shared` and `api` don't exist yet — that's fine; later tasks add them and re-run install.)

- [ ] **Step 6: Verify the toolchain**

Run: `npx tsc --version`
Expected: prints `Version 5.5.x`.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts .gitignore package-lock.json
git commit -m "chore: initialize npm-workspaces monorepo with vitest + typescript"
```

---

## Task 2: `shared` package skeleton + game-system catalogue (TDD)

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/shared/src/game-systems.ts`
- Test: `packages/shared/test/game-systems.test.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@club-night/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create a temporary `packages/shared/src/index.ts`**

(So the package resolves before all modules exist. Later steps extend it.)

```ts
export * from './game-systems';
```

- [ ] **Step 4: Re-run install so the workspace links**

Run: `npm install`
Expected: completes; `@club-night/shared` is now symlinked under `node_modules/@club-night/`.

- [ ] **Step 5: Write the failing test**

Create `packages/shared/test/game-systems.test.ts`:

```ts
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
    for (const system of GAME_SYSTEMS) {
      expect(system.name.length).toBeGreaterThan(0);
    }
  });

  it('recognises valid keys and rejects unknown ones', () => {
    expect(isGameSystemKey('WARHAMMER_40K')).toBe(true);
    expect(isGameSystemKey('CHESS')).toBe(false);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run packages/shared/test/game-systems.test.ts`
Expected: FAIL — cannot resolve `../src/game-systems`.

- [ ] **Step 7: Implement `packages/shared/src/game-systems.ts`**

```ts
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
}));

export function isGameSystemKey(value: string): value is GameSystemKey {
  return (GAME_SYSTEM_KEYS as readonly string[]).includes(value);
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run packages/shared/test/game-systems.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/shared package-lock.json
git commit -m "feat(shared): add game-system catalogue"
```

---

## Task 3: Domain status constants + Signup type (TDD)

**Files:**
- Create: `packages/shared/src/domain.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/domain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/domain.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/test/domain.test.ts`
Expected: FAIL — cannot resolve `../src/domain`.

- [ ] **Step 3: Implement `packages/shared/src/domain.ts`**

```ts
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
```

- [ ] **Step 4: Add `domain` to the barrel `packages/shared/src/index.ts`**

```ts
export * from './game-systems';
export * from './domain';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/shared/test/domain.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add domain status constants and Signup type"
```

---

## Task 4: Signup input validation schema (TDD)

**Files:**
- Create: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/test/schemas.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { signupInputSchema } from '../src/schemas';

const valid = {
  playerName: 'Ada',
  email: 'Ada@Example.com',
  systemKey: 'WARHAMMER_40K',
};

describe('signupInputSchema', () => {
  it('accepts valid input and normalises the email to lowercase', () => {
    const parsed = signupInputSchema.parse(valid);
    expect(parsed.email).toBe('ada@example.com');
    expect(parsed.playerName).toBe('Ada');
    expect(parsed.systemKey).toBe('WARHAMMER_40K');
  });

  it('rejects an empty name', () => {
    expect(() => signupInputSchema.parse({ ...valid, playerName: '' })).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => signupInputSchema.parse({ ...valid, email: 'not-an-email' })).toThrow();
  });

  it('rejects an unknown game system', () => {
    expect(() => signupInputSchema.parse({ ...valid, systemKey: 'CHESS' })).toThrow();
  });

  it('accepts an optional note', () => {
    const parsed = signupInputSchema.parse({ ...valid, note: 'First time playing!' });
    expect(parsed.note).toBe('First time playing!');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/shared/test/schemas.test.ts`
Expected: FAIL — cannot resolve `../src/schemas`.

- [ ] **Step 3: Implement `packages/shared/src/schemas.ts`**

```ts
import { z } from 'zod';
import { GAME_SYSTEM_KEYS } from './game-systems';

export const signupInputSchema = z.object({
  playerName: z.string().trim().min(1, 'Name is required').max(100),
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  systemKey: z.enum(GAME_SYSTEM_KEYS),
  note: z.string().trim().max(500).optional(),
});

export type SignupInput = z.infer<typeof signupInputSchema>;
```

- [ ] **Step 4: Add `schemas` to the barrel `packages/shared/src/index.ts`**

```ts
export * from './game-systems';
export * from './domain';
export * from './schemas';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/shared/test/schemas.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Typecheck the shared package**

Run: `npm run --workspace @club-night/shared typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add signup input validation schema"
```

---

## Task 5: `api` package skeleton

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`

- [ ] **Step 1: Create `packages/api/package.json`**

```json
{
  "name": "@club-night/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@club-night/shared": "*"
  }
}
```

- [ ] **Step 2: Create `packages/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Re-run install so the workspace links**

Run: `npm install`
Expected: completes; `@club-night/api` appears under `node_modules/@club-night/` and depends on the linked `@club-night/shared`.

- [ ] **Step 4: Commit**

```bash
git add packages/api package-lock.json
git commit -m "chore(api): add api package skeleton"
```

---

## Task 6: Fisher–Yates shuffle (TDD)

**Files:**
- Create: `packages/api/src/domain/pairing.ts`
- Test: `packages/api/test/pairing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api/test/pairing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fisherYatesShuffle } from '../src/domain/pairing';

describe('fisherYatesShuffle', () => {
  it('returns a permutation of the input', () => {
    const input = [1, 2, 3, 4, 5];
    const shuffled = fisherYatesShuffle(input, () => 0.5);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
  });

  it('does not mutate the input array', () => {
    const input = [1, 2, 3];
    fisherYatesShuffle(input, () => 0);
    expect(input).toEqual([1, 2, 3]);
  });

  it('is deterministic for a fixed rng', () => {
    const input = ['a', 'b', 'c'];
    const rng = () => 0;
    expect(fisherYatesShuffle(input, rng)).toEqual(fisherYatesShuffle(input, rng));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/api/test/pairing.test.ts`
Expected: FAIL — cannot resolve `../src/domain/pairing`.

- [ ] **Step 3: Implement the shuffle in `packages/api/src/domain/pairing.ts`**

```ts
export type Shuffle = <T>(items: readonly T[]) => T[];

/**
 * Fisher–Yates shuffle. Pure given its `rng` (defaults to Math.random in
 * production); inject a fake rng in tests for determinism.
 */
export function fisherYatesShuffle<T>(
  items: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/api/test/pairing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/domain/pairing.ts packages/api/test/pairing.test.ts
git commit -m "feat(api): add deterministic Fisher-Yates shuffle"
```

---

## Task 7: `pairNight` engine (TDD)

**Files:**
- Modify: `packages/api/src/domain/pairing.ts`
- Modify: `packages/api/test/pairing.test.ts`

- [ ] **Step 1: Add the failing tests**

Append to `packages/api/test/pairing.test.ts` (add the import of `pairNight` and `Signup`, and a `signup` factory, plus the new describe block):

```ts
import { pairNight } from '../src/domain/pairing';
import type { Signup } from '@club-night/shared';

function signup(id: string, systemKey: Signup['systemKey']): Signup {
  return {
    signupId: id,
    nightId: 'night-1',
    clubId: 'club-1',
    playerName: `Player ${id}`,
    email: `${id}@example.com`,
    systemKey,
    status: 'CONFIRMED',
  };
}

const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

describe('pairNight', () => {
  it('pairs two players in the same system', () => {
    const { pairings, unpaired } = pairNight(
      [signup('a', 'WARHAMMER_40K'), signup('b', 'WARHAMMER_40K')],
      identityShuffle,
    );
    expect(unpaired).toEqual([]);
    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.systemKey).toBe('WARHAMMER_40K');
    expect(pairings[0]!.players.map((p) => p.signupId)).toEqual(['a', 'b']);
  });

  it('flags the odd player out as unpaired', () => {
    const { pairings, unpaired } = pairNight(
      [
        signup('a', 'WARHAMMER_40K'),
        signup('b', 'WARHAMMER_40K'),
        signup('c', 'WARHAMMER_40K'),
      ],
      identityShuffle,
    );
    expect(pairings).toHaveLength(1);
    expect(unpaired.map((s) => s.signupId)).toEqual(['c']);
  });

  it('pairs each system independently', () => {
    const { pairings, unpaired } = pairNight(
      [
        signup('a', 'WARHAMMER_40K'),
        signup('b', 'WARHAMMER_40K'),
        signup('c', 'BLOOD_BOWL'),
      ],
      identityShuffle,
    );
    expect(pairings).toHaveLength(1);
    expect(pairings[0]!.systemKey).toBe('WARHAMMER_40K');
    expect(unpaired.map((s) => s.signupId)).toEqual(['c']);
  });

  it('returns an empty result for no signups', () => {
    expect(pairNight([], identityShuffle)).toEqual({ pairings: [], unpaired: [] });
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run packages/api/test/pairing.test.ts`
Expected: FAIL — `pairNight` is not exported.

- [ ] **Step 3: Implement `pairNight` (append to `packages/api/src/domain/pairing.ts`)**

```ts
import type { GameSystemKey, Signup } from '@club-night/shared';

export interface ProposedPairing {
  systemKey: GameSystemKey;
  players: [Signup, Signup];
}

export interface PairingResult {
  pairings: ProposedPairing[];
  unpaired: Signup[];
}

/**
 * Randomly pair confirmed signups within each game system. Any leftover odd
 * player per system is returned in `unpaired` for an organizer to resolve.
 * `shuffle` is injectable for deterministic tests (defaults to Fisher–Yates).
 */
export function pairNight(
  signups: readonly Signup[],
  shuffle: Shuffle = fisherYatesShuffle,
): PairingResult {
  const bySystem = new Map<GameSystemKey, Signup[]>();
  for (const signup of signups) {
    const group = bySystem.get(signup.systemKey) ?? [];
    group.push(signup);
    bySystem.set(signup.systemKey, group);
  }

  const pairings: ProposedPairing[] = [];
  const unpaired: Signup[] = [];

  for (const [systemKey, group] of bySystem) {
    const shuffled = shuffle(group);
    let i = 0;
    for (; i + 1 < shuffled.length; i += 2) {
      pairings.push({ systemKey, players: [shuffled[i]!, shuffled[i + 1]!] });
    }
    if (i < shuffled.length) {
      unpaired.push(shuffled[i]!);
    }
  }

  return { pairings, unpaired };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/api/test/pairing.test.ts`
Expected: PASS (7 tests total — 3 shuffle + 4 pairNight).

- [ ] **Step 5: Typecheck the api package**

Run: `npm run --workspace @club-night/api typecheck`
Expected: no output, exit 0.

- [ ] **Step 6: Run the full suite and typecheck everything**

Run: `npm test && npm run typecheck`
Expected: all tests PASS (game-systems 3, domain 5, schemas 5, pairing 7 = 20 tests); typecheck exits 0 for both packages.

- [ ] **Step 7: Commit**

```bash
git add packages/api
git commit -m "feat(api): add pairNight random within-system pairing engine"
```

---

## Done criteria

- `npm test` passes (20 tests across `shared` and `api`).
- `npm run typecheck` passes for both packages.
- The pairing engine pairs randomly within each system and flags odd players, with deterministic behaviour under an injected shuffle — ready for the data/API slice to call.
