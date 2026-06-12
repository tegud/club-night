# Pairing Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer generate random within-system pairings for a night (and re-roll), persisting full pairings and odd-ones-out, and view them.

**Architecture:** A `Pairing` domain type + `PAIRING#` single-table keys + a pairings repository (put / list / clear), a `generatePairings` service that filters `CONFIRMED` signups, runs the pure `pairNight` engine (slice 1), clears any existing pairings, and persists the result (`MATCHED` for complete pairs, `NEEDS_RESOLUTION` for the odd one), and two organizer-gated endpoints (generate, view). Builds on slices 1–3c.

**Tech Stack:** TypeScript, Hono, `@aws-sdk/lib-dynamodb`, `ulid`, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Pairing engine; § API surface — pairings; § single-table — Pairing item).
**Builds on:** slices 1, 2, 3a, 3b, 3c — 161 tests passing. The pure `pairNight(signups, shuffle?)` engine and `fisherYatesShuffle` already exist in `packages/api/src/domain/pairing.ts`.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Scope:** pairing generation + view only. Publish (emails + night→PAIRED), manual resolve (PATCH), and auto-pair scheduling are slice 3d-ii; the EventBridge wiring is slice 4. `generatePairings` does NOT change night status in this slice (that belongs with publish).

> **Domain refinement:** `PAIRING_STATUSES` changes from `['PUBLISHED','NEEDS_RESOLUTION']` to `['MATCHED','NEEDS_RESOLUTION']`. A pairing is `MATCHED` (two players) or `NEEDS_RESOLUTION` (a lone odd player); whether pairings are *published* is tracked on the night (`status: 'PAIRED'`). Nothing references the old `'PUBLISHED'` pairing value except its own test. The spec's single-table note will be updated to match.

---

## File structure produced by this plan

```
packages/
  shared/src/domain.ts               (MODIFY: PAIRING_STATUSES values; add Pairing, PairingPlayer)
  shared/test/domain.test.ts         (MODIFY: PAIRING_STATUSES assertion)
  api/
    src/
      db/keys.ts                     (MODIFY: add pairingPk, pairingSk, pairingSkPrefix)
      repositories/pairings.ts       putPairing, listPairingsByNight, deletePairingsByNight
      services/pairing-service.ts    generatePairings
      routes/pairings.ts             POST generate / GET pairings (organizer-gated)
      app.ts                         (MODIFY: mount pairingRoutes)
    test/
      repositories/pairings.test.ts
      services/pairing-service.test.ts
      routes/pairings.test.ts
```

---

## Task 1: `Pairing` domain types + `PAIRING_STATUSES` value change

**Files:**
- Modify: `packages/shared/src/domain.ts`
- Modify: `packages/shared/test/domain.test.ts`

- [ ] **Step 1: Update the failing assertion in `packages/shared/test/domain.test.ts`**

Find the existing `PAIRING_STATUSES` assertion (it currently expects `['PUBLISHED', 'NEEDS_RESOLUTION']`) and change it to:

```ts
  it('defines pairing statuses', () => {
    expect(PAIRING_STATUSES).toEqual(['MATCHED', 'NEEDS_RESOLUTION']);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/test/domain.test.ts`
Expected: FAIL — `PAIRING_STATUSES` still equals `['PUBLISHED','NEEDS_RESOLUTION']`.

- [ ] **Step 3: Update `PAIRING_STATUSES` and add the `Pairing` types in `packages/shared/src/domain.ts`**

Change the existing constant:

```ts
export const PAIRING_STATUSES = ['MATCHED', 'NEEDS_RESOLUTION'] as const;
export type PairingStatus = (typeof PAIRING_STATUSES)[number];
```

Then append the new interfaces (after the existing entities):

```ts
export interface PairingPlayer {
  signupId: string;
  playerName: string;
}

export interface Pairing {
  pairingId: string;
  nightId: string;
  clubId: string;
  systemKey: GameSystemKey;
  /** Two players for a MATCHED pairing; one for a NEEDS_RESOLUTION (odd) pairing. */
  players: PairingPlayer[];
  status: PairingStatus;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/shared/test/domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the workspace (no stale `'PUBLISHED'` references)**

Run: `npm run typecheck`
Expected: clean for both packages. (The pure pairing engine doesn't reference pairing status, so nothing else breaks.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/domain.ts packages/shared/test/domain.test.ts
git commit -m "feat(shared): add Pairing types; pairing status MATCHED/NEEDS_RESOLUTION"
```

---

## Task 2: Pairing keys + repository

**Files:**
- Modify: `packages/api/src/db/keys.ts`
- Create: `packages/api/src/repositories/pairings.ts`
- Test: `packages/api/test/repositories/pairings.test.ts`

- [ ] **Step 1: Add pairing key builders to `packages/api/src/db/keys.ts`**

Append:

```ts
export const pairingPk = (nightId: string): string => `NIGHT#${nightId}`;
export const pairingSk = (systemKey: string, pairingId: string): string =>
  `PAIRING#${systemKey}#${pairingId}`;
export const pairingSkPrefix = (): string => 'PAIRING#';
```

- [ ] **Step 2: Write the failing repo test — `packages/api/test/repositories/pairings.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { Pairing } from '@club-night/shared';
import { resetTable } from '../setup/table';
import { putPairing, listPairingsByNight, deletePairingsByNight } from '../../src/repositories/pairings';

beforeEach(async () => {
  await resetTable();
});

function pairing(overrides: Partial<Pairing> = {}): Pairing {
  return {
    pairingId: 'p1',
    nightId: 'night-1',
    clubId: 'club-1',
    systemKey: 'WARHAMMER_40K',
    players: [
      { signupId: 's1', playerName: 'Ada' },
      { signupId: 's2', playerName: 'Bob' },
    ],
    status: 'MATCHED',
    ...overrides,
  };
}

describe('pairings repository', () => {
  it('stores and lists pairings for a night', async () => {
    await putPairing(pairing({ pairingId: 'p1' }));
    await putPairing(pairing({ pairingId: 'p2', systemKey: 'BLOOD_BOWL' }));
    const list = await listPairingsByNight('night-1');
    expect(list.map((p) => p.pairingId).sort()).toEqual(['p1', 'p2']);
    expect(list.find((p) => p.pairingId === 'p1')!.players).toHaveLength(2);
  });

  it('scopes pairings to their night', async () => {
    await putPairing(pairing({ pairingId: 'p1', nightId: 'night-1' }));
    await putPairing(pairing({ pairingId: 'p2', nightId: 'night-2' }));
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
  });

  it('clears all pairings for a night', async () => {
    await putPairing(pairing({ pairingId: 'p1' }));
    await putPairing(pairing({ pairingId: 'p2', systemKey: 'BLOOD_BOWL' }));
    await deletePairingsByNight('night-1');
    expect(await listPairingsByNight('night-1')).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/pairings.test.ts`
Expected: FAIL — cannot resolve `../../src/repositories/pairings`.

- [ ] **Step 4: Implement `packages/api/src/repositories/pairings.ts`**

```ts
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Pairing } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { pairingPk, pairingSk, pairingSkPrefix } from '../db/keys';
import { queryAll } from '../db/query';

function toItem(p: Pairing): Record<string, unknown> {
  return {
    PK: pairingPk(p.nightId),
    SK: pairingSk(p.systemKey, p.pairingId),
    ...p,
  };
}

function fromItem(item: Record<string, any>): Pairing {
  return {
    pairingId: item.pairingId,
    nightId: item.nightId,
    clubId: item.clubId,
    systemKey: item.systemKey,
    players: item.players,
    status: item.status,
  };
}

export async function putPairing(pairing: Pairing): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(pairing) }));
}

export async function listPairingsByNight(nightId: string): Promise<Pairing[]> {
  const items = await queryAll({
    TableName: getTableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pairingPk(nightId), ':sk': pairingSkPrefix() },
  });
  return items.map(fromItem);
}

export async function deletePairingsByNight(nightId: string): Promise<void> {
  const items = await queryAll({
    TableName: getTableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': pairingPk(nightId), ':sk': pairingSkPrefix() },
  });
  for (const item of items) {
    await getDocClient().send(
      new DeleteCommand({ TableName: getTableName(), Key: { PK: item.PK, SK: item.SK } }),
    );
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/pairings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db/keys.ts packages/api/src/repositories/pairings.ts packages/api/test/repositories/pairings.test.ts
git commit -m "feat(api): add pairings repository"
```

---

## Task 3: `generatePairings` service

**Files:**
- Create: `packages/api/src/services/pairing-service.ts`
- Test: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/services/pairing-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { upsertSignup, putSignup } from '../../src/repositories/signups';
import { listPairingsByNight } from '../../src/repositories/pairings';
import { generatePairings } from '../../src/services/pairing-service';

beforeEach(async () => {
  await resetTable();
});

// Identity shuffle → deterministic pairing composition in input order.
const identityShuffle = <T>(items: readonly T[]): T[] => [...items];

async function seed(email: string, systemKey: 'WARHAMMER_40K' | 'BLOOD_BOWL') {
  return upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: email, email, systemKey });
}

describe('generatePairings', () => {
  it('pairs confirmed signups within each system and flags odd ones', async () => {
    await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await seed('c@x.com', 'WARHAMMER_40K'); // odd
    await seed('d@x.com', 'BLOOD_BOWL');
    await seed('e@x.com', 'BLOOD_BOWL');

    const pairings = await generatePairings('club-1', 'night-1', identityShuffle);

    const matched = pairings.filter((p) => p.status === 'MATCHED');
    const needsResolution = pairings.filter((p) => p.status === 'NEEDS_RESOLUTION');
    expect(matched).toHaveLength(2); // 1 x 40k pair + 1 x blood bowl pair
    expect(needsResolution).toHaveLength(1); // the odd 40k player
    expect(needsResolution[0]!.players).toHaveLength(1);
    expect(matched.every((p) => p.players.length === 2)).toBe(true);

    // persisted
    expect(await listPairingsByNight('night-1')).toHaveLength(3);
  });

  it('excludes cancelled signups', async () => {
    const a = await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await putSignup({ ...a, status: 'CANCELLED' }); // a withdraws

    const pairings = await generatePairings('club-1', 'night-1', identityShuffle);
    // only b remains confirmed → one NEEDS_RESOLUTION, no MATCHED
    expect(pairings.filter((p) => p.status === 'MATCHED')).toHaveLength(0);
    expect(pairings.filter((p) => p.status === 'NEEDS_RESOLUTION')).toHaveLength(1);
  });

  it('replaces previous pairings on re-generate', async () => {
    await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await generatePairings('club-1', 'night-1', identityShuffle);
    const second = await generatePairings('club-1', 'night-1', identityShuffle);
    // still exactly one matched pairing, not duplicated
    expect(second.filter((p) => p.status === 'MATCHED')).toHaveLength(1);
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: FAIL — cannot resolve `../../src/services/pairing-service`.

- [ ] **Step 3: Implement `packages/api/src/services/pairing-service.ts`**

```ts
import { ulid } from 'ulid';
import type { Pairing, PairingPlayer, Signup } from '@club-night/shared';
import { pairNight, fisherYatesShuffle, type Shuffle } from '../domain/pairing';
import { listSignupsByNight } from '../repositories/signups';
import { deletePairingsByNight, putPairing } from '../repositories/pairings';

function toPlayer(signup: Signup): PairingPlayer {
  return { signupId: signup.signupId, playerName: signup.playerName };
}

/**
 * Generate random within-system pairings for a night from its CONFIRMED signups.
 * Clears any existing pairings first (so this is also "re-roll"). `shuffle` is
 * injectable for deterministic tests; defaults to Fisher–Yates.
 */
export async function generatePairings(
  clubId: string,
  nightId: string,
  shuffle: Shuffle = fisherYatesShuffle,
): Promise<Pairing[]> {
  const confirmed = (await listSignupsByNight(nightId)).filter((s) => s.status === 'CONFIRMED');
  const { pairings, unpaired } = pairNight(confirmed, shuffle);

  const result: Pairing[] = [];
  for (const p of pairings) {
    result.push({
      pairingId: ulid(),
      nightId,
      clubId,
      systemKey: p.systemKey,
      players: p.players.map(toPlayer),
      status: 'MATCHED',
    });
  }
  for (const signup of unpaired) {
    result.push({
      pairingId: ulid(),
      nightId,
      clubId,
      systemKey: signup.systemKey,
      players: [toPlayer(signup)],
      status: 'NEEDS_RESOLUTION',
    });
  }

  await deletePairingsByNight(nightId);
  for (const pairing of result) {
    await putPairing(pairing);
  }
  return result;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): add generatePairings service"
```

---

## Task 4: Organizer pairing endpoints (generate + view)

**Files:**
- Create: `packages/api/src/routes/pairings.ts`
- Modify: `packages/api/src/app.ts` (mount the routes)
- Test: `packages/api/test/routes/pairings.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/routes/pairings.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight, sampleMembership } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { putMembership } from '../../src/repositories/memberships';
import { upsertSignup } from '../../src/repositories/signups';
import { setCognitoVerifier } from '../../src/auth/cognito';
import { createApp } from '../../src/app';

const ORGANIZER_TOKEN = 'organizer-token';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
  await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
  await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
  await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
  setCognitoVerifier({
    verify: async (token) => {
      if (token !== ORGANIZER_TOKEN) throw new Error('invalid');
      return { sub: 'user-1', email: 'olivia@example.com' };
    },
  });
});

afterEach(() => {
  setCognitoVerifier(undefined);
});

function generate(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/pairings/generate', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

function view(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/pairings', {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('POST /clubs/:slug/nights/:nightId/pairings/generate', () => {
  it('generates pairings for an organizer', async () => {
    const res = await generate(ORGANIZER_TOKEN);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.pairings).toHaveLength(1);
    expect(body.pairings[0].status).toBe('MATCHED');
    expect(body.pairings[0].players).toHaveLength(2);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await generate()).status).toBe(401);
  });

  it('rejects a non-organizer with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    expect((await generate(ORGANIZER_TOKEN)).status).toBe(403);
  });

  it('404s when the night does not exist', async () => {
    const res = await createApp().request('/clubs/red-dice/nights/missing/pairings/generate', {
      method: 'POST',
      headers: { authorization: `Bearer ${ORGANIZER_TOKEN}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /clubs/:slug/nights/:nightId/pairings', () => {
  it('returns generated pairings to an organizer', async () => {
    await generate(ORGANIZER_TOKEN);
    const res = await view(ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json() as any).pairings).toHaveLength(1);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await view()).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/pairings.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/pairings`.

- [ ] **Step 3: Implement `packages/api/src/routes/pairings.ts`**

```ts
import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug, requireNight } from './context';
import { requireOrganizer } from '../auth/authorize';
import { generatePairings } from '../services/pairing-service';
import { listPairingsByNight } from '../repositories/pairings';

export const pairingRoutes = new Hono<AppEnv>();

pairingRoutes.post('/clubs/:slug/nights/:nightId/pairings/generate', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const pairings = await generatePairings(club.clubId, night.nightId);
  return c.json({ pairings }, 201);
});

pairingRoutes.get('/clubs/:slug/nights/:nightId/pairings', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const pairings = await listPairingsByNight(night.nightId);
  return c.json({ pairings });
});
```

- [ ] **Step 4: Mount the routes in `packages/api/src/app.ts`**

Add the import and a mount line (full file):

```ts
import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { authMiddleware, type AppEnv } from './auth/middleware';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';
import { signupRoutes } from './routes/signups';
import { guestRoutes } from './routes/guest';
import { organizerNightRoutes } from './routes/organizer-nights';
import { signupManagementRoutes } from './routes/signup-management';
import { pairingRoutes } from './routes/pairings';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.use('*', authMiddleware);

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);
  app.route('/', signupRoutes);
  app.route('/', guestRoutes);
  app.route('/', organizerNightRoutes);
  app.route('/', signupManagementRoutes);
  app.route('/', pairingRoutes);

  return app;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/pairings.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New this slice: pairings-repo 3, pairing-service 3, pairings-route 6 = **12** (Task 1 only modified an existing assertion). Added to 161 → **173 total**. Typecheck clean for both packages.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/pairings.ts packages/api/src/app.ts packages/api/test/routes/pairings.test.ts
git commit -m "feat(api): add organizer generate + view pairings endpoints"
```

---

## Done criteria

- `npm test` passes (173 tests: 161 prior + 12 new).
- `npm run typecheck` passes for both packages.
- An organizer can `POST .../pairings/generate` to randomly pair the night's `CONFIRMED` signups within each system (odd players flagged `NEEDS_RESOLUTION`), re-roll (regenerate replaces), and `GET .../pairings` to view them. Cancelled signups are excluded. Anonymous → 401, non-organizer → 403.
- Pairing generation does not change night status and sends no emails — both belong to slice 3d-ii (publish).
- Carry-forwards: slice 3d-ii adds publish (emails players via the existing `EmailSender`, sets night `status: 'PAIRED'`, idempotent), manual resolve (PATCH a `NEEDS_RESOLUTION` pairing to assign/merge a second player), and a `runNightPairing(clubId, nightId)` handler composing generate+publish for the slice-4 EventBridge schedule to invoke.
