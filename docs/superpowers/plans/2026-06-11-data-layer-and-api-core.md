# Data Layer & API Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single-table DynamoDB data-access layer and the public, no-auth-required slice of the Hono API (club branding, night listing/detail, guest signup creation), all integration-tested locally.

**Architecture:** `packages/api` gains a `db/` layer (key builders, table schema, document client), a `repositories/` layer (clubs, nights, signups) mapping domain entities ↔ single-table items, and an `http/`+`routes/` layer built on Hono. Routes are nested under the club (`/clubs/:slug/...`) to match path-based tenancy and the club-partitioned keys. Integration tests run against `dynalite` (in-process DynamoDB) via a Vitest global setup; the Hono app is exercised with `app.request()` (no network server).

**Tech Stack:** TypeScript, Hono, `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`, `ulid`, zod, Vitest, `dynalite` (test only).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md`
**Builds on:** `docs/superpowers/plans/2026-06-11-foundation-and-pairing-engine.md` (the `shared` package + pairing engine already exist; 23 tests passing).

> **Commit note:** This plan follows TDD with frequent commits as discrete steps. The repo owner prefers to control commits — treat each "Commit" step as the owner's call to run (or batch), not an instruction to auto-commit.

> **Spec refinements made in this plan (deliberate):**
> 1. **Nested routes.** The spec's flat `GET /nights/:nightId` etc. become `GET /clubs/:slug/nights/:nightId` and `POST /clubs/:slug/nights/:nightId/signups`. Reason: items are partitioned by `clubId`, so a night/signup cannot be located by its own id alone; nesting under the club (which the path-based tenancy always knows) avoids an extra GSI.
> 2. **Signup acceptance is gated on `night.status === 'OPEN'`** rather than a wall-clock deadline comparison. The timed OPEN→CLOSED transition is a slice-3 concern (EventBridge).
> 3. **`dynalite`** is the test double for DynamoDB. Production uses real DynamoDB.

---

## File structure produced by this plan

```
packages/
  shared/
    src/domain.ts                 (MODIFY: add Club, GameNight, OfferedSystem)
  api/
    package.json                  (MODIFY: add runtime + dev deps)
    src/
      db/
        config.ts                 loadDbConfig() — env-driven table/endpoint/region
        keys.ts                   pure PK/SK/GSI key builders
        table.ts                  index names + buildCreateTableInput()
        client.ts                 getDocClient(), getTableName()
      repositories/
        clubs.ts                  putClub, getClubById, getClubBySlug
        nights.ts                 putNight, getNight, listNightsByClub
        signups.ts                upsertSignup, getSignup, listSignupsByNight, findSignupByEmail
      http/
        errors.ts                 HttpError + NotFoundError/ValidationError/ConflictError
        error-handler.ts          onError() Hono handler
        validate.ts               parseOrThrow(schema, data)
      routes/
        context.ts                requireClubBySlug, requireNight
        clubs.ts                  clubRoutes (GET /:slug)
        nights.ts                 nightRoutes (GET /, GET /:nightId)
        signups.ts                signupRoutes (POST /)
      app.ts                      createApp()
      handler.ts                  Lambda entry via hono/aws-lambda
    test/
      setup/
        global-setup.ts           boots dynalite for the test run
        table.ts                  resetTable() helper
        dynalite.d.ts             module declaration for dynalite
      fixtures.ts                 sampleClub(), sampleNight()
      db/keys.test.ts
      db/table.test.ts
      db/config.test.ts
      db/smoke.test.ts
      repositories/clubs.test.ts
      repositories/nights.test.ts
      repositories/signups.test.ts
      http/errors.test.ts
      routes/clubs.test.ts
      routes/nights.test.ts
      routes/signups.test.ts
vitest.config.ts                  (MODIFY: globalSetup, env, fileParallelism)
```

---

## Task 1: Extend `shared` domain with Club, GameNight, OfferedSystem types

**Files:**
- Modify: `packages/shared/src/domain.ts`

These entities are needed by the data layer. They are compiler-verified (no runtime test) and will be exercised by the repository integration tests in later tasks.

- [ ] **Step 1: Append the new types to `packages/shared/src/domain.ts`**

Add at the end of the file (the existing `Signup` interface stays as-is):

```ts
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
```

- [ ] **Step 2: Verify the shared package still typechecks**

Run: `npm run --workspace @club-night/shared typecheck`
Expected: no output, exit 0.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: 23 tests pass (no behaviour changed; types are additive).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/domain.ts
git commit -m "feat(shared): add Club, GameNight, OfferedSystem domain types"
```

---

## Task 2: API dependencies + DB config, key builders, table schema (TDD)

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/src/db/config.ts`
- Create: `packages/api/src/db/keys.ts`
- Create: `packages/api/src/db/table.ts`
- Test: `packages/api/test/db/config.test.ts`, `packages/api/test/db/keys.test.ts`, `packages/api/test/db/table.test.ts`

- [ ] **Step 1: Add dependencies to `packages/api/package.json`**

Replace the file with (keeps name/scripts, adds deps):

```json
{
  "name": "@club-night/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.637.0",
    "@aws-sdk/lib-dynamodb": "^3.637.0",
    "@club-night/shared": "*",
    "hono": "^4.5.8",
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "dynalite": "^3.2.2"
  }
}
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes; the new packages appear under `node_modules/`.

- [ ] **Step 3: Write the failing config test**

Create `packages/api/test/db/config.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { loadDbConfig } from '../../src/db/config';

const ORIGINAL = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('loadDbConfig', () => {
  it('reads table name, endpoint and region from the environment', () => {
    process.env.CLUB_NIGHT_TABLE = 'my-table';
    process.env.DYNAMODB_ENDPOINT = 'http://localhost:8000';
    process.env.AWS_REGION = 'eu-west-2';
    expect(loadDbConfig()).toEqual({
      tableName: 'my-table',
      endpoint: 'http://localhost:8000',
      region: 'eu-west-2',
    });
  });

  it('defaults region and leaves endpoint undefined when unset', () => {
    delete process.env.DYNAMODB_ENDPOINT;
    delete process.env.AWS_REGION;
    process.env.CLUB_NIGHT_TABLE = 'club-night';
    const cfg = loadDbConfig();
    expect(cfg.endpoint).toBeUndefined();
    expect(cfg.region).toBe('eu-west-2');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run packages/api/test/db/config.test.ts`
Expected: FAIL — cannot resolve `../../src/db/config`.

- [ ] **Step 5: Implement `packages/api/src/db/config.ts`**

```ts
export interface DbConfig {
  tableName: string;
  endpoint?: string;
  region: string;
}

export function loadDbConfig(): DbConfig {
  const endpoint = process.env.DYNAMODB_ENDPOINT;
  return {
    tableName: process.env.CLUB_NIGHT_TABLE ?? 'club-night',
    ...(endpoint ? { endpoint } : {}),
    region: process.env.AWS_REGION ?? 'eu-west-2',
  };
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/api/test/db/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the failing keys test**

Create `packages/api/test/db/keys.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  clubPk,
  clubMetaSk,
  clubSlugGsi1Pk,
  nightSk,
  nightSkPrefix,
  signupPk,
  signupSk,
  signupSkPrefix,
  signupEmailGsi3Pk,
  userGsi2Pk,
} from '../../src/db/keys';

describe('key builders', () => {
  it('builds club keys', () => {
    expect(clubPk('c1')).toBe('CLUB#c1');
    expect(clubMetaSk()).toBe('#META');
    expect(clubSlugGsi1Pk('red-dice')).toBe('CLUBSLUG#red-dice');
  });

  it('builds night keys', () => {
    expect(nightSk('n1')).toBe('NIGHT#n1');
    expect(nightSkPrefix()).toBe('NIGHT#');
  });

  it('builds signup keys', () => {
    expect(signupPk('n1')).toBe('NIGHT#n1');
    expect(signupSk('s1')).toBe('SIGNUP#s1');
    expect(signupSkPrefix()).toBe('SIGNUP#');
    expect(signupEmailGsi3Pk('n1', 'ada@example.com')).toBe('NIGHT#n1#EMAIL#ada@example.com');
  });

  it('builds the user GSI2 partition key', () => {
    expect(userGsi2Pk('u1')).toBe('USER#u1');
  });
});
```

- [ ] **Step 8: Run it to verify it fails**

Run: `npx vitest run packages/api/test/db/keys.test.ts`
Expected: FAIL — cannot resolve `../../src/db/keys`.

- [ ] **Step 9: Implement `packages/api/src/db/keys.ts`**

```ts
export const clubPk = (clubId: string): string => `CLUB#${clubId}`;
export const clubMetaSk = (): string => '#META';
export const clubSlugGsi1Pk = (slug: string): string => `CLUBSLUG#${slug}`;

export const nightSk = (nightId: string): string => `NIGHT#${nightId}`;
export const nightSkPrefix = (): string => 'NIGHT#';

export const signupPk = (nightId: string): string => `NIGHT#${nightId}`;
export const signupSk = (signupId: string): string => `SIGNUP#${signupId}`;
export const signupSkPrefix = (): string => 'SIGNUP#';
export const signupEmailGsi3Pk = (nightId: string, emailLower: string): string =>
  `NIGHT#${nightId}#EMAIL#${emailLower}`;

export const userGsi2Pk = (userId: string): string => `USER#${userId}`;
```

- [ ] **Step 10: Run it to verify it passes**

Run: `npx vitest run packages/api/test/db/keys.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 11: Write the failing table-schema test**

Create `packages/api/test/db/table.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TABLE_INDEXES, buildCreateTableInput } from '../../src/db/table';

describe('table schema', () => {
  it('names the three GSIs', () => {
    expect(TABLE_INDEXES).toEqual({ bySlug: 'GSI1', byUser: 'GSI2', byNightEmail: 'GSI3' });
  });

  it('builds a CreateTable input with PK/SK and three GSIs', () => {
    const input = buildCreateTableInput('club-night-test');
    expect(input.TableName).toBe('club-night-test');
    expect(input.BillingMode).toBe('PAY_PER_REQUEST');
    expect(input.KeySchema).toEqual([
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ]);
    expect(input.GlobalSecondaryIndexes).toHaveLength(3);
    const indexNames = input.GlobalSecondaryIndexes!.map((g) => g.IndexName).sort();
    expect(indexNames).toEqual(['GSI1', 'GSI2', 'GSI3']);
  });

  it('declares every key attribute used by the table and its indexes', () => {
    const input = buildCreateTableInput('club-night-test');
    const attrs = input.AttributeDefinitions!.map((a) => a.AttributeName).sort();
    expect(attrs).toEqual([
      'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK', 'PK', 'SK',
    ]);
  });
});
```

- [ ] **Step 12: Run it to verify it fails**

Run: `npx vitest run packages/api/test/db/table.test.ts`
Expected: FAIL — cannot resolve `../../src/db/table`.

- [ ] **Step 13: Implement `packages/api/src/db/table.ts`**

```ts
import type { CreateTableCommandInput } from '@aws-sdk/client-dynamodb';

export const TABLE_INDEXES = {
  bySlug: 'GSI1',
  byUser: 'GSI2',
  byNightEmail: 'GSI3',
} as const;

function gsi(name: string) {
  return {
    IndexName: name,
    KeySchema: [
      { AttributeName: `${name}PK`, KeyType: 'HASH' as const },
      { AttributeName: `${name}SK`, KeyType: 'RANGE' as const },
    ],
    Projection: { ProjectionType: 'ALL' as const },
  };
}

export function buildCreateTableInput(tableName: string): CreateTableCommandInput {
  return {
    TableName: tableName,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'PK', AttributeType: 'S' },
      { AttributeName: 'SK', AttributeType: 'S' },
      { AttributeName: 'GSI1PK', AttributeType: 'S' },
      { AttributeName: 'GSI1SK', AttributeType: 'S' },
      { AttributeName: 'GSI2PK', AttributeType: 'S' },
      { AttributeName: 'GSI2SK', AttributeType: 'S' },
      { AttributeName: 'GSI3PK', AttributeType: 'S' },
      { AttributeName: 'GSI3SK', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'PK', KeyType: 'HASH' },
      { AttributeName: 'SK', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [gsi('GSI1'), gsi('GSI2'), gsi('GSI3')],
  };
}
```

- [ ] **Step 14: Run all three db tests + typecheck**

Run: `npx vitest run packages/api/test/db && npm run --workspace @club-night/api typecheck`
Expected: PASS (config 2, keys 4, table 3 = 9 tests); typecheck exits 0.

- [ ] **Step 15: Commit**

```bash
git add packages/api/package.json packages/api/src/db packages/api/test/db package-lock.json
git commit -m "feat(api): add db config, key builders and single-table schema"
```

---

## Task 3: DynamoDB client + dynalite test harness (integration smoke)

**Files:**
- Create: `packages/api/src/db/client.ts`
- Create: `packages/api/test/setup/dynalite.d.ts`
- Create: `packages/api/test/setup/global-setup.ts`
- Create: `packages/api/test/setup/table.ts`
- Modify: `vitest.config.ts` (repo root)
- Test: `packages/api/test/db/smoke.test.ts`

- [ ] **Step 1: Implement `packages/api/src/db/client.ts`**

```ts
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { loadDbConfig } from './config';

let docClient: DynamoDBDocumentClient | undefined;

export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    const cfg = loadDbConfig();
    const base = new DynamoDBClient({
      region: cfg.region,
      ...(cfg.endpoint
        ? { endpoint: cfg.endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
        : {}),
    });
    docClient = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return docClient;
}

export function getTableName(): string {
  return loadDbConfig().tableName;
}
```

- [ ] **Step 2: Declare the `dynalite` module — `packages/api/test/setup/dynalite.d.ts`**

(dynalite ships no types.)

```ts
declare module 'dynalite' {
  import type { Server } from 'node:http';
  interface DynaliteOptions {
    createTableMs?: number;
    deleteTableMs?: number;
    updateTableMs?: number;
  }
  export default function dynalite(options?: DynaliteOptions): Server;
}
```

- [ ] **Step 3: Create the global setup — `packages/api/test/setup/global-setup.ts`**

```ts
import dynalite from 'dynalite';

export default async function setup(): Promise<() => Promise<void>> {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0, updateTableMs: 0 });
  await new Promise<void>((resolve) => server.listen(8000, () => resolve()));

  return async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };
}
```

- [ ] **Step 4: Create the table reset helper — `packages/api/test/setup/table.ts`**

```ts
import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { buildCreateTableInput } from '../../src/db/table';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'eu-west-2',
  endpoint: process.env.DYNAMODB_ENDPOINT,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

/** Drop and recreate the table so each test starts from a clean slate. */
export async function resetTable(): Promise<void> {
  const tableName = process.env.CLUB_NIGHT_TABLE ?? 'club-night-test';
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }
  await client.send(new CreateTableCommand(buildCreateTableInput(tableName)));
}
```

- [ ] **Step 5: Update the root `vitest.config.ts`**

Replace it with:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globalSetup: ['packages/api/test/setup/global-setup.ts'],
    fileParallelism: false,
    env: {
      DYNAMODB_ENDPOINT: 'http://localhost:8000',
      CLUB_NIGHT_TABLE: 'club-night-test',
      AWS_REGION: 'eu-west-2',
    },
  },
});
```

(`fileParallelism: false` is required: all integration tests share one dynalite table and reset it per test, so files must run sequentially.)

- [ ] **Step 6: Write the failing smoke test — `packages/api/test/db/smoke.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { resetTable } from '../setup/table';
import { getDocClient, getTableName } from '../../src/db/client';

beforeEach(async () => {
  await resetTable();
});

describe('dynamodb harness', () => {
  it('round-trips an item through dynalite', async () => {
    await getDocClient().send(
      new PutCommand({ TableName: getTableName(), Item: { PK: 'TEST#1', SK: '#META', hello: 'world' } }),
    );
    const res = await getDocClient().send(
      new GetCommand({ TableName: getTableName(), Key: { PK: 'TEST#1', SK: '#META' } }),
    );
    expect(res.Item).toMatchObject({ hello: 'world' });
  });
});
```

- [ ] **Step 7: Run the smoke test to verify the harness works**

Run: `npx vitest run packages/api/test/db/smoke.test.ts`
Expected: PASS (1 test). If it fails to connect, confirm dynalite started on port 8000 (global setup) and the env vars are set in `vitest.config.ts`.

- [ ] **Step 8: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass (shared 15, api: pairing 8 + config 2 + keys 4 + table 3 + smoke 1 = 33 total); typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/api/src/db/client.ts packages/api/test/setup packages/api/test/db/smoke.test.ts vitest.config.ts
git commit -m "test(api): add dynamodb document client and dynalite test harness"
```

---

## Task 4: Clubs repository + test fixtures (TDD integration)

**Files:**
- Create: `packages/api/test/fixtures.ts`
- Create: `packages/api/src/repositories/clubs.ts`
- Test: `packages/api/test/repositories/clubs.test.ts`

- [ ] **Step 1: Create shared test fixtures — `packages/api/test/fixtures.ts`**

```ts
import type { Club, GameNight } from '@club-night/shared';

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
```

- [ ] **Step 2: Write the failing clubs repo test — `packages/api/test/repositories/clubs.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub } from '../fixtures';
import { putClub, getClubById, getClubBySlug } from '../../src/repositories/clubs';

beforeEach(async () => {
  await resetTable();
});

describe('clubs repository', () => {
  it('stores and fetches a club by id', async () => {
    await putClub(sampleClub());
    const club = await getClubById('club-1');
    expect(club).not.toBeNull();
    expect(club!.name).toBe('Red Dice Club');
    expect(club!.enabledSystems).toEqual(['WARHAMMER_40K', 'BLOOD_BOWL']);
  });

  it('fetches a club by slug', async () => {
    await putClub(sampleClub());
    const club = await getClubBySlug('red-dice');
    expect(club!.clubId).toBe('club-1');
  });

  it('returns null for an unknown id', async () => {
    expect(await getClubById('missing')).toBeNull();
  });

  it('returns null for an unknown slug', async () => {
    expect(await getClubBySlug('missing')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/clubs.test.ts`
Expected: FAIL — cannot resolve `../../src/repositories/clubs`.

- [ ] **Step 4: Implement `packages/api/src/repositories/clubs.ts`**

```ts
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Club } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { clubMetaSk, clubPk, clubSlugGsi1Pk } from '../db/keys';
import { TABLE_INDEXES } from '../db/table';

function toItem(club: Club): Record<string, unknown> {
  return {
    PK: clubPk(club.clubId),
    SK: clubMetaSk(),
    GSI1PK: clubSlugGsi1Pk(club.slug),
    GSI1SK: clubPk(club.clubId),
    ...club,
  };
}

function fromItem(item: Record<string, any>): Club {
  return {
    clubId: item.clubId,
    slug: item.slug,
    name: item.name,
    logoUrl: item.logoUrl,
    primaryColour: item.primaryColour,
    enabledSystems: item.enabledSystems,
  };
}

export async function putClub(club: Club): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(club) }));
}

export async function getClubById(clubId: string): Promise<Club | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: clubPk(clubId), SK: clubMetaSk() } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function getClubBySlug(slug: string): Promise<Club | null> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: TABLE_INDEXES.bySlug,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': clubSlugGsi1Pk(slug) },
      Limit: 1,
    }),
  );
  const item = res.Items?.[0];
  return item ? fromItem(item) : null;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/clubs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/repositories/clubs.ts packages/api/test/repositories/clubs.test.ts packages/api/test/fixtures.ts
git commit -m "feat(api): add clubs repository"
```

---

## Task 5: Nights repository (TDD integration)

**Files:**
- Create: `packages/api/src/repositories/nights.ts`
- Test: `packages/api/test/repositories/nights.test.ts`

- [ ] **Step 1: Write the failing nights repo test — `packages/api/test/repositories/nights.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleNight } from '../fixtures';
import { putNight, getNight, listNightsByClub } from '../../src/repositories/nights';

beforeEach(async () => {
  await resetTable();
});

describe('nights repository', () => {
  it('stores and fetches a night by club + id', async () => {
    await putNight(sampleNight());
    const night = await getNight('club-1', 'night-1');
    expect(night).not.toBeNull();
    expect(night!.title).toBe('Thursday Night Gaming');
    expect(night!.offeredSystems).toHaveLength(2);
    expect(night!.status).toBe('OPEN');
  });

  it('returns null for an unknown night', async () => {
    expect(await getNight('club-1', 'missing')).toBeNull();
  });

  it('lists all nights for a club', async () => {
    await putNight(sampleNight({ nightId: 'night-1' }));
    await putNight(sampleNight({ nightId: 'night-2', title: 'Second Night' }));
    await putNight(sampleNight({ nightId: 'other', clubId: 'club-2' }));
    const nights = await listNightsByClub('club-1');
    expect(nights.map((n) => n.nightId).sort()).toEqual(['night-1', 'night-2']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/nights.test.ts`
Expected: FAIL — cannot resolve `../../src/repositories/nights`.

- [ ] **Step 3: Implement `packages/api/src/repositories/nights.ts`**

```ts
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { GameNight } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { clubPk, nightSk, nightSkPrefix } from '../db/keys';

function toItem(night: GameNight): Record<string, unknown> {
  return {
    PK: clubPk(night.clubId),
    SK: nightSk(night.nightId),
    ...night,
  };
}

function fromItem(item: Record<string, any>): GameNight {
  return {
    nightId: item.nightId,
    clubId: item.clubId,
    title: item.title,
    eventDate: item.eventDate,
    signupDeadline: item.signupDeadline,
    status: item.status,
    eventType: item.eventType,
    pairingStrategy: item.pairingStrategy,
    offeredSystems: item.offeredSystems,
    createdBy: item.createdBy,
  };
}

export async function putNight(night: GameNight): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(night) }));
}

export async function getNight(clubId: string, nightId: string): Promise<GameNight | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: clubPk(clubId), SK: nightSk(nightId) } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function listNightsByClub(clubId: string): Promise<GameNight[]> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': clubPk(clubId), ':sk': nightSkPrefix() },
    }),
  );
  return (res.Items ?? []).map(fromItem);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/nights.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/nights.ts packages/api/test/repositories/nights.test.ts
git commit -m "feat(api): add nights repository"
```

---

## Task 6: Signups repository with email-dedup upsert (TDD integration)

**Files:**
- Create: `packages/api/src/repositories/signups.ts`
- Test: `packages/api/test/repositories/signups.test.ts`

- [ ] **Step 1: Write the failing signups repo test — `packages/api/test/repositories/signups.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import {
  upsertSignup,
  getSignup,
  listSignupsByNight,
  findSignupByEmail,
} from '../../src/repositories/signups';

beforeEach(async () => {
  await resetTable();
});

const base = {
  nightId: 'night-1',
  clubId: 'club-1',
  playerName: 'Ada',
  email: 'ada@example.com',
  systemKey: 'WARHAMMER_40K' as const,
};

describe('signups repository', () => {
  it('creates a confirmed signup with a generated id', async () => {
    const signup = await upsertSignup(base);
    expect(signup.signupId).toBeTruthy();
    expect(signup.status).toBe('CONFIRMED');
    const fetched = await getSignup('night-1', signup.signupId);
    expect(fetched!.playerName).toBe('Ada');
  });

  it('updates the same signup when the email repeats for a night (one per email)', async () => {
    const first = await upsertSignup(base);
    const second = await upsertSignup({ ...base, playerName: 'Ada L.', systemKey: 'BLOOD_BOWL' });
    expect(second.signupId).toBe(first.signupId);
    const all = await listSignupsByNight('night-1');
    expect(all).toHaveLength(1);
    expect(all[0]!.playerName).toBe('Ada L.');
    expect(all[0]!.systemKey).toBe('BLOOD_BOWL');
  });

  it('treats the same email on different nights as separate signups', async () => {
    await upsertSignup(base);
    await upsertSignup({ ...base, nightId: 'night-2' });
    expect(await listSignupsByNight('night-1')).toHaveLength(1);
    expect(await listSignupsByNight('night-2')).toHaveLength(1);
  });

  it('finds a signup by night + email', async () => {
    await upsertSignup(base);
    const found = await findSignupByEmail('night-1', 'ada@example.com');
    expect(found!.playerName).toBe('Ada');
  });

  it('persists an optional note', async () => {
    const signup = await upsertSignup({ ...base, note: 'First time!' });
    const fetched = await getSignup('night-1', signup.signupId);
    expect(fetched!.note).toBe('First time!');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/signups.test.ts`
Expected: FAIL — cannot resolve `../../src/repositories/signups`.

- [ ] **Step 3: Implement `packages/api/src/repositories/signups.ts`**

```ts
import { GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import type { GameSystemKey, Signup } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import {
  signupEmailGsi3Pk,
  signupPk,
  signupSk,
  signupSkPrefix,
  userGsi2Pk,
} from '../db/keys';
import { TABLE_INDEXES } from '../db/table';

export interface CreateSignupInput {
  nightId: string;
  clubId: string;
  playerName: string;
  email: string;
  systemKey: GameSystemKey;
  note?: string;
  userId?: string;
}

function toItem(signup: Signup): Record<string, unknown> {
  const item: Record<string, unknown> = {
    PK: signupPk(signup.nightId),
    SK: signupSk(signup.signupId),
    GSI3PK: signupEmailGsi3Pk(signup.nightId, signup.email),
    GSI3SK: signupSk(signup.signupId),
    ...signup,
  };
  if (signup.userId) {
    item.GSI2PK = userGsi2Pk(signup.userId);
    item.GSI2SK = signupSk(signup.signupId);
  }
  return item;
}

function fromItem(item: Record<string, any>): Signup {
  return {
    signupId: item.signupId,
    nightId: item.nightId,
    clubId: item.clubId,
    playerName: item.playerName,
    email: item.email,
    systemKey: item.systemKey,
    status: item.status,
    ...(item.userId !== undefined ? { userId: item.userId } : {}),
    ...(item.note !== undefined ? { note: item.note } : {}),
    ...(item.requestedOpponentSignupId !== undefined
      ? { requestedOpponentSignupId: item.requestedOpponentSignupId }
      : {}),
  };
}

export async function findSignupByEmail(nightId: string, emailLower: string): Promise<Signup | null> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      IndexName: TABLE_INDEXES.byNightEmail,
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': signupEmailGsi3Pk(nightId, emailLower) },
      Limit: 1,
    }),
  );
  const item = res.Items?.[0];
  return item ? fromItem(item) : null;
}

/**
 * Create a signup, or update the existing one if this email already signed up
 * for this night (one signup per email per night). Email is lowercased.
 */
export async function upsertSignup(input: CreateSignupInput): Promise<Signup> {
  const email = input.email.toLowerCase();
  const existing = await findSignupByEmail(input.nightId, email);
  const signupId = existing?.signupId ?? ulid();
  const signup: Signup = {
    signupId,
    nightId: input.nightId,
    clubId: input.clubId,
    playerName: input.playerName,
    email,
    systemKey: input.systemKey,
    status: 'CONFIRMED',
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
  };
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(signup) }));
  return signup;
}

export async function getSignup(nightId: string, signupId: string): Promise<Signup | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: signupPk(nightId), SK: signupSk(signupId) } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function listSignupsByNight(nightId: string): Promise<Signup[]> {
  const res = await getDocClient().send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': signupPk(nightId), ':sk': signupSkPrefix() },
    }),
  );
  return (res.Items ?? []).map(fromItem);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/signups.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/signups.ts packages/api/test/repositories/signups.test.ts
git commit -m "feat(api): add signups repository with one-per-email upsert"
```

---

## Task 7: HTTP error model, error handler, validation helper (TDD unit)

**Files:**
- Create: `packages/api/src/http/errors.ts`
- Create: `packages/api/src/http/error-handler.ts`
- Create: `packages/api/src/http/validate.ts`
- Test: `packages/api/test/http/errors.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/http/errors.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../src/http/errors';
import { onError } from '../../src/http/error-handler';
import { parseOrThrow } from '../../src/http/validate';

function appThatThrows(err: Error): Hono {
  const app = new Hono();
  app.onError(onError);
  app.get('/boom', () => {
    throw err;
  });
  return app;
}

describe('http error handling', () => {
  it('maps NotFoundError to a 404 structured body', async () => {
    const res = await appThatThrows(new NotFoundError('Club not found')).request('/boom');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Club not found' } });
  });

  it('maps ConflictError to a 409', async () => {
    const res = await appThatThrows(new ConflictError('Not open')).request('/boom');
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('maps an unknown error to a 500 without leaking the message', async () => {
    const res = await appThatThrows(new Error('secret internals')).request('/boom');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(body)).not.toContain('secret internals');
  });
});

describe('parseOrThrow', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('returns parsed data on success', () => {
    expect(parseOrThrow(schema, { name: 'Ada' })).toEqual({ name: 'Ada' });
  });

  it('throws a ValidationError with details on failure', () => {
    try {
      parseOrThrow(schema, { name: '' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).status).toBe(400);
      expect((err as ValidationError).details).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/http/errors.test.ts`
Expected: FAIL — cannot resolve `../../src/http/errors`.

- [ ] **Step 3: Implement `packages/api/src/http/errors.ts`**

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(
    public readonly status: ContentfulStatusCode,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = 'Conflict') {
    super(409, 'CONFLICT', message);
  }
}

export class ValidationError extends HttpError {
  constructor(
    message = 'Validation failed',
    public readonly details?: unknown,
  ) {
    super(400, 'VALIDATION_ERROR', message);
  }
}
```

- [ ] **Step 4: Implement `packages/api/src/http/error-handler.ts`**

```ts
import type { Context } from 'hono';
import { HttpError, ValidationError } from './errors';

export function onError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    const body: { code: string; message: string; details?: unknown } = {
      code: err.code,
      message: err.message,
    };
    if (err instanceof ValidationError && err.details !== undefined) {
      body.details = err.details;
    }
    return c.json({ error: body }, err.status);
  }

  console.error('Unhandled error', err);
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, 500);
}
```

- [ ] **Step 5: Implement `packages/api/src/http/validate.ts`**

```ts
import type { ZodSchema } from 'zod';
import { ValidationError } from './errors';

export function parseOrThrow<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Validation failed', result.error.flatten());
  }
  return result.data;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/api/test/http/errors.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/http packages/api/test/http
git commit -m "feat(api): add http error model, error handler and validation helper"
```

---

## Task 8: App skeleton, route context helpers, clubs route (TDD integration)

**Files:**
- Create: `packages/api/src/routes/context.ts`
- Create: `packages/api/src/routes/clubs.ts`
- Create: `packages/api/src/app.ts`
- Test: `packages/api/test/routes/clubs.test.ts`

> Note: `app.ts` references `nightRoutes` and `signupRoutes` which are created in Tasks 9 and 10. To keep the app importable now, this task registers ONLY the clubs route; Tasks 9 and 10 each add one `app.route(...)` line. The version of `app.ts` written here is complete and valid on its own.

- [ ] **Step 1: Write the failing clubs route test — `packages/api/test/routes/clubs.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
});

describe('GET /clubs/:slug', () => {
  it('returns branding for an existing club', async () => {
    await putClub(sampleClub());
    const res = await createApp().request('/clubs/red-dice');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      clubId: 'club-1',
      slug: 'red-dice',
      name: 'Red Dice Club',
      logoUrl: 'https://example.test/logo.png',
      primaryColour: '#B22222',
      enabledSystems: ['WARHAMMER_40K', 'BLOOD_BOWL'],
    });
  });

  it('404s for an unknown slug', async () => {
    const res = await createApp().request('/clubs/missing');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/clubs.test.ts`
Expected: FAIL — cannot resolve `../../src/app`.

- [ ] **Step 3: Implement `packages/api/src/routes/context.ts`**

```ts
import type { Club, GameNight } from '@club-night/shared';
import { getClubBySlug } from '../repositories/clubs';
import { getNight } from '../repositories/nights';
import { NotFoundError } from '../http/errors';

export async function requireClubBySlug(slug: string): Promise<Club> {
  const club = await getClubBySlug(slug);
  if (!club) throw new NotFoundError('Club not found');
  return club;
}

export async function requireNight(clubId: string, nightId: string): Promise<GameNight> {
  const night = await getNight(clubId, nightId);
  if (!night) throw new NotFoundError('Game night not found');
  return night;
}
```

- [ ] **Step 4: Implement `packages/api/src/routes/clubs.ts`**

```ts
import { Hono } from 'hono';
import { requireClubBySlug } from './context';

export const clubRoutes = new Hono();

clubRoutes.get('/clubs/:slug', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  return c.json({
    clubId: club.clubId,
    slug: club.slug,
    name: club.name,
    logoUrl: club.logoUrl,
    primaryColour: club.primaryColour,
    enabledSystems: club.enabledSystems,
  });
});
```

- [ ] **Step 5: Implement `packages/api/src/app.ts`**

```ts
import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { clubRoutes } from './routes/clubs';

export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.route('/', clubRoutes);

  return app;
}
```

(Each route module declares its own full path and is mounted at `/`. This avoids relying on Hono propagating a parent mount path's params into a sub-app — every `:slug`/`:nightId` lives in the route's own pattern.)

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/clubs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/context.ts packages/api/src/routes/clubs.ts packages/api/src/app.ts packages/api/test/routes/clubs.test.ts
git commit -m "feat(api): add hono app skeleton and club branding route"
```

---

## Task 9: Nights routes — list + detail (TDD integration)

**Files:**
- Create: `packages/api/src/routes/nights.ts`
- Modify: `packages/api/src/app.ts` (add one route mount)
- Test: `packages/api/test/routes/nights.test.ts`

- [ ] **Step 1: Write the failing nights route test — `packages/api/test/routes/nights.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
});

describe('GET /clubs/:slug/nights', () => {
  it('lists non-cancelled nights sorted by event date', async () => {
    await putNight(sampleNight({ nightId: 'n-late', eventDate: '2026-08-01T18:00:00.000Z' }));
    await putNight(sampleNight({ nightId: 'n-early', eventDate: '2026-07-01T18:00:00.000Z' }));
    await putNight(sampleNight({ nightId: 'n-cancelled', status: 'CANCELLED' }));

    const res = await createApp().request('/clubs/red-dice/nights');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.nights.map((n: { nightId: string }) => n.nightId)).toEqual(['n-early', 'n-late']);
  });

  it('404s when the club does not exist', async () => {
    const res = await createApp().request('/clubs/missing/nights');
    expect(res.status).toBe(404);
  });
});

describe('GET /clubs/:slug/nights/:nightId', () => {
  it('returns a single night', async () => {
    await putNight(sampleNight({ nightId: 'night-1' }));
    const res = await createApp().request('/clubs/red-dice/nights/night-1');
    expect(res.status).toBe(200);
    expect((await res.json()).night.title).toBe('Thursday Night Gaming');
  });

  it('404s for an unknown night', async () => {
    const res = await createApp().request('/clubs/red-dice/nights/missing');
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/nights.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/nights` (and route not mounted).

- [ ] **Step 3: Implement `packages/api/src/routes/nights.ts`**

```ts
import { Hono } from 'hono';
import { requireClubBySlug, requireNight } from './context';
import { listNightsByClub } from '../repositories/nights';

export const nightRoutes = new Hono();

nightRoutes.get('/clubs/:slug/nights', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const nights = await listNightsByClub(club.clubId);
  const visible = nights
    .filter((n) => n.status !== 'CANCELLED')
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate));
  return c.json({ nights: visible });
});

nightRoutes.get('/clubs/:slug/nights/:nightId', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  return c.json({ night });
});
```

- [ ] **Step 4: Mount the route in `packages/api/src/app.ts`**

Add the import and the mount line (full file shown):

```ts
import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';

export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);

  return app;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/nights.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/nights.ts packages/api/src/app.ts packages/api/test/routes/nights.test.ts
git commit -m "feat(api): add night listing and detail routes"
```

---

## Task 10: Signup creation route + Lambda handler (TDD integration)

**Files:**
- Create: `packages/api/src/routes/signups.ts`
- Create: `packages/api/src/handler.ts`
- Modify: `packages/api/src/app.ts` (add one route mount)
- Test: `packages/api/test/routes/signups.test.ts`

- [ ] **Step 1: Write the failing signups route test — `packages/api/test/routes/signups.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { listSignupsByNight } from '../../src/repositories/signups';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
});

function post(body: unknown) {
  return createApp().request('/clubs/red-dice/nights/night-1/signups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = { playerName: 'Ada', email: 'Ada@Example.com', systemKey: 'WARHAMMER_40K' };

describe('POST /clubs/:slug/nights/:nightId/signups', () => {
  it('creates a signup on an open night and lowercases the email', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    const res = await post(validBody);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.signup.signupId).toBeTruthy();
    expect(body.signup.email).toBe('ada@example.com');
    expect(body.signup.status).toBe('CONFIRMED');
    expect(await listSignupsByNight('night-1')).toHaveLength(1);
  });

  it('rejects invalid input with a 400', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    const res = await post({ playerName: '', email: 'nope', systemKey: 'CHESS' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects signup when the night is not open with a 409', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'CLOSED' }));
    const res = await post(validBody);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICT');
  });

  it('404s when the night does not exist', async () => {
    const res = await post(validBody);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/signups.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/signups` (and route not mounted).

- [ ] **Step 3: Implement `packages/api/src/routes/signups.ts`**

```ts
import { Hono } from 'hono';
import { signupInputSchema } from '@club-night/shared';
import { requireClubBySlug, requireNight } from './context';
import { upsertSignup } from '../repositories/signups';
import { ConflictError } from '../http/errors';
import { parseOrThrow } from '../http/validate';

export const signupRoutes = new Hono();

signupRoutes.post('/clubs/:slug/nights/:nightId/signups', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  if (night.status !== 'OPEN') {
    throw new ConflictError('This game night is not open for signups');
  }

  const raw = await c.req.json().catch(() => ({}));
  const input = parseOrThrow(signupInputSchema, raw);

  const signup = await upsertSignup({
    nightId: night.nightId,
    clubId: club.clubId,
    playerName: input.playerName,
    email: input.email,
    systemKey: input.systemKey,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });

  return c.json({ signup }, 201);
});
```

- [ ] **Step 4: Mount the route in `packages/api/src/app.ts`**

Full file:

```ts
import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';
import { signupRoutes } from './routes/signups';

export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);
  app.route('/', signupRoutes);

  return app;
}
```

- [ ] **Step 5: Implement the Lambda handler — `packages/api/src/handler.ts`**

```ts
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';

export const handler = handle(createApp());
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/signups.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. Test tally:
- shared: 15
- api: pairing 8, config 2, keys 4, table 3, smoke 1, clubs-repo 4, nights-repo 3, signups-repo 5, http-errors 5, clubs-route 2, nights-route 4, signups-route 4 = **45**
- **Total: 60 tests**, typecheck clean for both packages.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/routes/signups.ts packages/api/src/handler.ts packages/api/src/app.ts packages/api/test/routes/signups.test.ts
git commit -m "feat(api): add signup creation route and lambda handler"
```

---

## Done criteria

- `npm test` passes (60 tests: shared 15, api 45).
- `npm run typecheck` passes for both packages.
- The data layer (clubs, nights, signups) round-trips against dynalite with single-table keys + GSIs, including one-signup-per-email-per-night.
- The Hono API serves club branding, night list/detail, and guest signup creation under `/clubs/:slug/...`, with structured error responses, and is Lambda-deployable via `handler.ts`.
- Auth (Cognito + guest code), email (SES), organizer night CRUD, pairing persistence/endpoints, and the EventBridge auto-pair trigger remain for slice 3.
```
