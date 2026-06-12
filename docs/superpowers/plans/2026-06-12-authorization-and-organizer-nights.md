# Authorization & Organizer Night Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate organizers (Cognito) and authorize them per-club so they can create, edit/cancel game nights and view a night's signups.

**Architecture:** A `memberships` repository (who organizes which club), a Cognito JWT verifier behind a test-overridable wrapper, a unified `Principal` (guest | cognito) resolved from the `Authorization` header by a Hono middleware, a `requireOrganizer` authorization helper, and an organizer-only night routes module gated by it. Built on slices 1–3a (db layer, repositories, http/error model, guest-session verify).

**Tech Stack:** TypeScript, Hono, `aws-jwt-verify`, jose (already present), zod, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Authentication & authorization; § API surface — organizer routes).
**Builds on:** slices 1, 2, 3a — 87 tests passing.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Scope:** authorization machinery + organizer night CRUD only. Signup-management endpoints (guest/owner) and signup-confirmation email are slice 3c; pairing is slice 3d. Do not build those here.

---

## File structure produced by this plan

```
packages/
  shared/src/domain.ts               (MODIFY: add Membership)
  shared/src/schemas.ts              (MODIFY: add offeredSystemSchema, createNightSchema, updateNightSchema)
  api/
    package.json                     (MODIFY: add aws-jwt-verify)
    src/
      db/keys.ts                     (MODIFY: add membershipSk, membershipSkPrefix)
      repositories/memberships.ts    putMembership, getMembership
      auth/
        cognito.ts                   verifyCognitoToken + setCognitoVerifier (test override)
        principal.ts                 Principal union + resolvePrincipal
        middleware.ts                AppEnv + authMiddleware
        authorize.ts                 requireOrganizer
      http/errors.ts                 (MODIFY: add ForbiddenError)
      routes/organizer-nights.ts     POST create / PATCH update / GET signups
      app.ts                         (MODIFY: type as Hono<AppEnv>, use authMiddleware, mount organizer routes)
    test/
      fixtures.ts                    (MODIFY: add sampleMembership)
      repositories/memberships.test.ts
      auth/cognito.test.ts
      auth/principal.test.ts
      auth/middleware.test.ts
      auth/authorize.test.ts
      routes/organizer-nights.test.ts
  shared/test/schemas.test.ts        (MODIFY: add night-schema tests)
```

---

## Task 1: Membership type, keys, and repository

**Files:**
- Modify: `packages/shared/src/domain.ts`
- Modify: `packages/api/src/db/keys.ts`
- Modify: `packages/api/test/fixtures.ts`
- Create: `packages/api/src/repositories/memberships.ts`
- Test: `packages/api/test/repositories/memberships.test.ts`

- [ ] **Step 1: Add the `Membership` interface to `packages/shared/src/domain.ts`**

Append:

```ts
export interface Membership {
  clubId: string;
  userId: string;
  role: MemberRole;
  displayName: string;
  email: string;
}
```

- [ ] **Step 2: Add membership key builders to `packages/api/src/db/keys.ts`**

Append:

```ts
export const membershipSk = (userId: string): string => `MEMBER#${userId}`;
export const membershipSkPrefix = (): string => 'MEMBER#';
```

- [ ] **Step 3: Add a `sampleMembership` fixture to `packages/api/test/fixtures.ts`**

Add the import for `Membership` (extend the existing `import type { Club, GameNight } from '@club-night/shared';` to include `Membership`) and append:

```ts
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
```

- [ ] **Step 4: Write the failing repo test — `packages/api/test/repositories/memberships.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleMembership } from '../fixtures';
import { putMembership, getMembership } from '../../src/repositories/memberships';

beforeEach(async () => {
  await resetTable();
});

describe('memberships repository', () => {
  it('stores and fetches a membership by club + user', async () => {
    await putMembership(sampleMembership());
    const m = await getMembership('club-1', 'user-1');
    expect(m).not.toBeNull();
    expect(m!.role).toBe('OWNER');
    expect(m!.displayName).toBe('Olivia Organizer');
  });

  it('returns null when the user is not a member of the club', async () => {
    await putMembership(sampleMembership());
    expect(await getMembership('club-1', 'someone-else')).toBeNull();
    expect(await getMembership('club-2', 'user-1')).toBeNull();
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/memberships.test.ts`
Expected: FAIL — cannot resolve `../../src/repositories/memberships`.

- [ ] **Step 6: Implement `packages/api/src/repositories/memberships.ts`**

```ts
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import type { Membership } from '@club-night/shared';
import { getDocClient, getTableName } from '../db/client';
import { clubPk, membershipSk, userGsi2Pk } from '../db/keys';

function toItem(m: Membership): Record<string, unknown> {
  return {
    PK: clubPk(m.clubId),
    SK: membershipSk(m.userId),
    GSI2PK: userGsi2Pk(m.userId),
    GSI2SK: clubPk(m.clubId),
    ...m,
  };
}

function fromItem(item: Record<string, any>): Membership {
  return {
    clubId: item.clubId,
    userId: item.userId,
    role: item.role,
    displayName: item.displayName,
    email: item.email,
  };
}

export async function putMembership(m: Membership): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(m) }));
}

export async function getMembership(clubId: string, userId: string): Promise<Membership | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: clubPk(clubId), SK: membershipSk(userId) } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/memberships.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/domain.ts packages/api/src/db/keys.ts packages/api/test/fixtures.ts packages/api/src/repositories/memberships.ts packages/api/test/repositories/memberships.test.ts
git commit -m "feat(api): add memberships repository"
```

---

## Task 2: Cognito JWT verifier (test-overridable wrapper)

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/src/auth/cognito.ts`
- Test: `packages/api/test/auth/cognito.test.ts`

- [ ] **Step 1: Add `aws-jwt-verify` to `packages/api/package.json` dependencies**

Add `"aws-jwt-verify": "^4.0.1"` to the `dependencies` block (alphabetically after `@club-night/shared` is fine; exact position doesn't matter).

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes; `aws-jwt-verify` resolves under `node_modules/`.

- [ ] **Step 3: Write the failing test — `packages/api/test/auth/cognito.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { verifyCognitoToken, setCognitoVerifier } from '../../src/auth/cognito';

afterEach(() => {
  setCognitoVerifier(undefined);
});

describe('verifyCognitoToken', () => {
  it('returns claims when the underlying verifier accepts the token', async () => {
    setCognitoVerifier({
      verify: async (token) => {
        if (token !== 'good-token') throw new Error('invalid');
        return { sub: 'user-1', email: 'olivia@example.com' };
      },
    });
    expect(await verifyCognitoToken('good-token')).toEqual({ sub: 'user-1', email: 'olivia@example.com' });
  });

  it('returns null when the underlying verifier rejects the token', async () => {
    setCognitoVerifier({
      verify: async () => {
        throw new Error('invalid');
      },
    });
    expect(await verifyCognitoToken('bad-token')).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/cognito.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/cognito`.

- [ ] **Step 5: Implement `packages/api/src/auth/cognito.ts`**

```ts
import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface CognitoClaims {
  sub: string;
  email?: string;
}

export interface CognitoTokenVerifier {
  verify(token: string): Promise<CognitoClaims>;
}

let override: CognitoTokenVerifier | undefined;
let real: CognitoTokenVerifier | undefined;

/** Override the Cognito verifier (used by tests). Pass undefined to reset. */
export function setCognitoVerifier(next: CognitoTokenVerifier | undefined): void {
  override = next;
}

function realVerifier(): CognitoTokenVerifier {
  if (!real) {
    const verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
      clientId: process.env.COGNITO_CLIENT_ID ?? '',
      tokenUse: 'id',
    });
    real = {
      async verify(token) {
        const payload = await verifier.verify(token);
        return {
          sub: String(payload.sub),
          email: typeof payload.email === 'string' ? payload.email : undefined,
        };
      },
    };
  }
  return real;
}

/** Verify a Cognito ID token; returns its claims, or null if invalid. */
export async function verifyCognitoToken(token: string): Promise<CognitoClaims | null> {
  try {
    return await (override ?? realVerifier()).verify(token);
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/cognito.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api/package.json packages/api/src/auth/cognito.ts packages/api/test/auth/cognito.test.ts package-lock.json
git commit -m "feat(api): add Cognito JWT verifier wrapper"
```

---

## Task 3: ForbiddenError + Principal + resolvePrincipal

**Files:**
- Modify: `packages/api/src/http/errors.ts`
- Create: `packages/api/src/auth/principal.ts`
- Test: `packages/api/test/auth/principal.test.ts`

- [ ] **Step 1: Add `ForbiddenError` to `packages/api/src/http/errors.ts`**

Append:

```ts
export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}
```

- [ ] **Step 2: Write the failing test — `packages/api/test/auth/principal.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolvePrincipal } from '../../src/auth/principal';
import { issueGuestSession } from '../../src/auth/guest-session';
import { setCognitoVerifier } from '../../src/auth/cognito';

afterEach(() => {
  setCognitoVerifier(undefined);
});

describe('resolvePrincipal', () => {
  it('returns undefined when there is no Authorization header', async () => {
    expect(await resolvePrincipal(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-Bearer header', async () => {
    expect(await resolvePrincipal('Basic abc')).toBeUndefined();
  });

  it('resolves a guest principal from a guest-session token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    expect(await resolvePrincipal(`Bearer ${token}`)).toEqual({
      kind: 'guest',
      email: 'ada@example.com',
      clubId: 'club-1',
    });
  });

  it('resolves a cognito principal when the cognito verifier accepts the token', async () => {
    setCognitoVerifier({
      verify: async () => ({ sub: 'user-1', email: 'olivia@example.com' }),
    });
    expect(await resolvePrincipal('Bearer cognito-token')).toEqual({
      kind: 'cognito',
      userId: 'user-1',
      email: 'olivia@example.com',
    });
  });

  it('returns undefined when the token is neither a valid guest nor cognito token', async () => {
    setCognitoVerifier({
      verify: async () => {
        throw new Error('invalid');
      },
    });
    expect(await resolvePrincipal('Bearer garbage')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/principal.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/principal`.

- [ ] **Step 4: Implement `packages/api/src/auth/principal.ts`**

```ts
import { verifyGuestSession } from './guest-session';
import { verifyCognitoToken } from './cognito';

export type Principal =
  | { kind: 'guest'; email: string; clubId: string }
  | { kind: 'cognito'; userId: string; email?: string };

/** Resolve the caller from an Authorization header. Tries guest-session, then Cognito. */
export async function resolvePrincipal(authHeader: string | undefined): Promise<Principal | undefined> {
  if (!authHeader) return undefined;
  const match = /^Bearer (.+)$/.exec(authHeader.trim());
  if (!match) return undefined;
  const token = match[1]!;

  const guest = await verifyGuestSession(token);
  if (guest) return { kind: 'guest', email: guest.email, clubId: guest.clubId };

  const cognito = await verifyCognitoToken(token);
  if (cognito) {
    return cognito.email !== undefined
      ? { kind: 'cognito', userId: cognito.sub, email: cognito.email }
      : { kind: 'cognito', userId: cognito.sub };
  }

  return undefined;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/principal.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/http/errors.ts packages/api/src/auth/principal.ts packages/api/test/auth/principal.test.ts
git commit -m "feat(api): add ForbiddenError and principal resolution"
```

---

## Task 4: Auth middleware + apply it in the app

**Files:**
- Create: `packages/api/src/auth/middleware.ts`
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/test/auth/middleware.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/auth/middleware.test.ts`**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, type AppEnv } from '../../src/auth/middleware';
import { issueGuestSession } from '../../src/auth/guest-session';
import { setCognitoVerifier } from '../../src/auth/cognito';

afterEach(() => {
  setCognitoVerifier(undefined);
});

function probeApp() {
  const app = new Hono<AppEnv>();
  app.use('*', authMiddleware);
  app.get('/whoami', (c) => c.json({ principal: c.get('principal') ?? null }));
  return app;
}

describe('authMiddleware', () => {
  it('sets a guest principal from a guest-session bearer token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    const res = await probeApp().request('/whoami', { headers: { authorization: `Bearer ${token}` } });
    expect((await res.json()).principal).toEqual({ kind: 'guest', email: 'ada@example.com', clubId: 'club-1' });
  });

  it('sets null when there is no Authorization header', async () => {
    const res = await probeApp().request('/whoami');
    expect((await res.json()).principal).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/middleware.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/middleware`.

- [ ] **Step 3: Implement `packages/api/src/auth/middleware.ts`**

```ts
import { createMiddleware } from 'hono/factory';
import { resolvePrincipal, type Principal } from './principal';

export type AppEnv = { Variables: { principal?: Principal } };

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const principal = await resolvePrincipal(c.req.header('authorization'));
  c.set('principal', principal);
  await next();
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/middleware.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Apply the middleware in `packages/api/src/app.ts`**

Type the app as `Hono<AppEnv>` and register the middleware before the routes (full file):

```ts
import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { authMiddleware, type AppEnv } from './auth/middleware';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';
import { signupRoutes } from './routes/signups';
import { guestRoutes } from './routes/guest';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.use('*', authMiddleware);

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);
  app.route('/', signupRoutes);
  app.route('/', guestRoutes);

  return app;
}
```

- [ ] **Step 6: Run the full suite to confirm no regression**

Run: `npm test`
Expected: all prior tests still pass (the middleware is harmless for routes that don't read `principal`; requests without an Authorization header resolve to `undefined`). Count: 87 prior + memberships 2 + cognito 2 + principal 5 + middleware 2 = **98**.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/auth/middleware.ts packages/api/src/app.ts packages/api/test/auth/middleware.test.ts
git commit -m "feat(api): add auth middleware and apply it to the app"
```

---

## Task 5: requireOrganizer authorization helper

**Files:**
- Create: `packages/api/src/auth/authorize.ts`
- Test: `packages/api/test/auth/authorize.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/auth/authorize.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleMembership } from '../fixtures';
import { putMembership } from '../../src/repositories/memberships';
import { requireOrganizer } from '../../src/auth/authorize';
import { ForbiddenError, UnauthorizedError } from '../../src/http/errors';
import type { Principal } from '../../src/auth/principal';

beforeEach(async () => {
  await resetTable();
});

const cognito = (userId: string): Principal => ({ kind: 'cognito', userId, email: 'o@example.com' });

describe('requireOrganizer', () => {
  it('returns the membership for an OWNER', async () => {
    await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
    const m = await requireOrganizer(cognito('user-1'), 'club-1');
    expect(m.role).toBe('OWNER');
  });

  it('allows an ORGANIZER', async () => {
    await putMembership(sampleMembership({ userId: 'user-2', role: 'ORGANIZER' }));
    const m = await requireOrganizer(cognito('user-2'), 'club-1');
    expect(m.role).toBe('ORGANIZER');
  });

  it('throws Forbidden for a PLAYER member', async () => {
    await putMembership(sampleMembership({ userId: 'user-3', role: 'PLAYER' }));
    await expect(requireOrganizer(cognito('user-3'), 'club-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws Forbidden when the user has no membership of the club', async () => {
    await expect(requireOrganizer(cognito('stranger'), 'club-1')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws Unauthorized when there is no principal', async () => {
    await expect(requireOrganizer(undefined, 'club-1')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('throws Unauthorized for a guest principal', async () => {
    const guest: Principal = { kind: 'guest', email: 'a@b.com', clubId: 'club-1' };
    await expect(requireOrganizer(guest, 'club-1')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/authorize.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/authorize`.

- [ ] **Step 3: Implement `packages/api/src/auth/authorize.ts`**

```ts
import type { Membership } from '@club-night/shared';
import type { Principal } from './principal';
import { getMembership } from '../repositories/memberships';
import { ForbiddenError, UnauthorizedError } from '../http/errors';

/**
 * Require that the principal is a Cognito user who is an OWNER or ORGANIZER of the club.
 * Returns their membership. Throws Unauthorized (no/!cognito principal) or Forbidden
 * (not an organizing member).
 */
export async function requireOrganizer(
  principal: Principal | undefined,
  clubId: string,
): Promise<Membership> {
  if (!principal || principal.kind !== 'cognito') {
    throw new UnauthorizedError('Organizer sign-in required');
  }
  const membership = await getMembership(clubId, principal.userId);
  if (!membership || (membership.role !== 'OWNER' && membership.role !== 'ORGANIZER')) {
    throw new ForbiddenError('You are not an organizer of this club');
  }
  return membership;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/authorize.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/authorize.ts packages/api/test/auth/authorize.test.ts
git commit -m "feat(api): add requireOrganizer authorization helper"
```

---

## Task 6: Night create/update validation schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Test: `packages/shared/test/schemas.test.ts`

- [ ] **Step 1: Add the failing tests to `packages/shared/test/schemas.test.ts`**

Append a new describe block (and add the imports at the top of the file: `import { createNightSchema, updateNightSchema } from '../src/schemas';`):

```ts
describe('createNightSchema', () => {
  const valid = {
    title: 'Thursday Night',
    eventDate: '2026-07-02T18:00:00.000Z',
    signupDeadline: '2026-07-02T12:00:00.000Z',
    offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }],
  };

  it('accepts valid input', () => {
    expect(createNightSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an empty title', () => {
    expect(() => createNightSchema.parse({ ...valid, title: '' })).toThrow();
  });

  it('rejects a non-ISO eventDate', () => {
    expect(() => createNightSchema.parse({ ...valid, eventDate: 'next thursday' })).toThrow();
  });

  it('rejects an empty offeredSystems list', () => {
    expect(() => createNightSchema.parse({ ...valid, offeredSystems: [] })).toThrow();
  });

  it('rejects an unknown system key', () => {
    expect(() =>
      createNightSchema.parse({ ...valid, offeredSystems: [{ systemKey: 'CHESS', prominent: true }] }),
    ).toThrow();
  });
});

describe('updateNightSchema', () => {
  it('accepts a partial update', () => {
    expect(updateNightSchema.parse({ title: 'Renamed' })).toEqual({ title: 'Renamed' });
  });

  it('accepts a status change', () => {
    expect(updateNightSchema.parse({ status: 'CANCELLED' })).toEqual({ status: 'CANCELLED' });
  });

  it('rejects an unknown status', () => {
    expect(() => updateNightSchema.parse({ status: 'NOPE' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/test/schemas.test.ts`
Expected: FAIL — `createNightSchema` / `updateNightSchema` are not exported.

- [ ] **Step 3: Implement the schemas in `packages/shared/src/schemas.ts`**

Add the imports for `NIGHT_STATUSES` (extend the existing imports), then append:

```ts
import { NIGHT_STATUSES } from './domain';

export const offeredSystemSchema = z.object({
  systemKey: z.enum(GAME_SYSTEM_KEYS),
  prominent: z.boolean(),
});

export const createNightSchema = z.object({
  title: z.string().trim().min(1).max(200),
  eventDate: z.string().datetime(),
  signupDeadline: z.string().datetime(),
  offeredSystems: z.array(offeredSystemSchema).min(1),
});
export type CreateNightInput = z.infer<typeof createNightSchema>;

export const updateNightSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  eventDate: z.string().datetime().optional(),
  signupDeadline: z.string().datetime().optional(),
  offeredSystems: z.array(offeredSystemSchema).min(1).optional(),
  status: z.enum(NIGHT_STATUSES).optional(),
});
export type UpdateNightInput = z.infer<typeof updateNightSchema>;
```

> Note: `GAME_SYSTEM_KEYS` is already imported at the top of `schemas.ts` (from slice 1). Add only the `NIGHT_STATUSES` import. Keep the existing `import { z } from 'zod';` at the top — do not duplicate it.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/shared/test/schemas.test.ts`
Expected: PASS (existing schema tests + 8 new = the file's full count, all green).

- [ ] **Step 5: Typecheck shared**

Run: `npm run --workspace @club-night/shared typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/test/schemas.test.ts
git commit -m "feat(shared): add night create/update validation schemas"
```

---

## Task 7: Organizer create-night endpoint

**Files:**
- Create: `packages/api/src/routes/organizer-nights.ts`
- Modify: `packages/api/src/app.ts` (mount the routes)
- Test: `packages/api/test/routes/organizer-nights.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/routes/organizer-nights.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleMembership } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putMembership } from '../../src/repositories/memberships';
import { listNightsByClub } from '../../src/repositories/nights';
import { setCognitoVerifier } from '../../src/auth/cognito';
import { createApp } from '../../src/app';

const ORGANIZER_TOKEN = 'organizer-token';

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub()); // enabledSystems: WARHAMMER_40K, BLOOD_BOWL
  await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
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

const validBody = {
  title: 'Thursday Night',
  eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z',
  offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }],
};

function createNight(body: unknown, token?: string) {
  return createApp().request('/clubs/red-dice/nights', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('POST /clubs/:slug/nights (organizer)', () => {
  it('creates an OPEN night for an organizer', async () => {
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.night.nightId).toBeTruthy();
    expect(body.night.status).toBe('OPEN');
    expect(body.night.eventType).toBe('SCHEDULED_GAME_NIGHT');
    expect(body.night.createdBy).toBe('user-1');
    expect(await listNightsByClub('club-1')).toHaveLength(1);
  });

  it('rejects an offered system not enabled for the club (400)', async () => {
    const res = await createNight(
      { ...validBody, offeredSystems: [{ systemKey: 'AGE_OF_SIGMAR', prominent: true }] },
      ORGANIZER_TOKEN,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await createNight(validBody);
    expect(res.status).toBe(401);
  });

  it('rejects a non-organizer (no membership) with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/organizer-nights`.

- [ ] **Step 3: Implement `packages/api/src/routes/organizer-nights.ts`**

```ts
import { Hono } from 'hono';
import { ulid } from 'ulid';
import { createNightSchema } from '@club-night/shared';
import type { GameNight } from '@club-night/shared';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug } from './context';
import { requireOrganizer } from '../auth/authorize';
import { parseOrThrow } from '../http/validate';
import { ValidationError } from '../http/errors';
import { putNight } from '../repositories/nights';

export const organizerNightRoutes = new Hono<AppEnv>();

organizerNightRoutes.post('/clubs/:slug/nights', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const membership = await requireOrganizer(c.get('principal'), club.clubId);
  const input = parseOrThrow(createNightSchema, await c.req.json().catch(() => ({})));

  for (const offered of input.offeredSystems) {
    if (!club.enabledSystems.includes(offered.systemKey)) {
      throw new ValidationError(`System ${offered.systemKey} is not enabled for this club`);
    }
  }

  const night: GameNight = {
    nightId: ulid(),
    clubId: club.clubId,
    title: input.title,
    eventDate: input.eventDate,
    signupDeadline: input.signupDeadline,
    status: 'OPEN',
    eventType: 'SCHEDULED_GAME_NIGHT',
    pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
    offeredSystems: input.offeredSystems,
    createdBy: membership.userId,
  };
  await putNight(night);
  return c.json({ night }, 201);
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

  return app;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/organizer-nights.ts packages/api/src/app.ts packages/api/test/routes/organizer-nights.test.ts
git commit -m "feat(api): add organizer create-night endpoint"
```

---

## Task 8: Organizer update-night endpoint (edit / cancel)

**Files:**
- Modify: `packages/api/src/routes/organizer-nights.ts`
- Modify: `packages/api/test/routes/organizer-nights.test.ts`
- Modify: `packages/api/src/repositories/nights.ts` (no change expected; `putNight` is reused)

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/organizer-nights.test.ts`**

Append (the imports for `getNight` and the helper are added here; `sampleNight` is already in fixtures):

```ts
import { getNight, putNight } from '../../src/repositories/nights';
import { sampleNight } from '../fixtures';

function updateNight(nightId: string, body: unknown, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/${nightId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('PATCH /clubs/:slug/nights/:nightId (organizer)', () => {
  beforeEach(async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  });

  it('updates the title for an organizer', async () => {
    const res = await updateNight('night-1', { title: 'Renamed Night' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json()).night.title).toBe('Renamed Night');
    expect((await getNight('club-1', 'night-1'))!.title).toBe('Renamed Night');
  });

  it('cancels a night via a status change', async () => {
    const res = await updateNight('night-1', { status: 'CANCELLED' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await getNight('club-1', 'night-1'))!.status).toBe('CANCELLED');
  });

  it('rejects an offered system not enabled for the club (400)', async () => {
    const res = await updateNight(
      'night-1',
      { offeredSystems: [{ systemKey: 'AGE_OF_SIGMAR', prominent: true }] },
      ORGANIZER_TOKEN,
    );
    expect(res.status).toBe(400);
  });

  it('404s for an unknown night', async () => {
    const res = await updateNight('missing', { title: 'x' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(404);
  });

  it('rejects a non-organizer with 401', async () => {
    const res = await updateNight('night-1', { title: 'x' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify the new tests fail**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: FAIL — PATCH route not defined (404/405 instead of expected statuses).

- [ ] **Step 3: Add the PATCH handler to `packages/api/src/routes/organizer-nights.ts`**

Add `updateNightSchema` to the `@club-night/shared` import, add `requireNight` to the `./context` import, and append the handler:

```ts
organizerNightRoutes.patch('/clubs/:slug/nights/:nightId', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const input = parseOrThrow(updateNightSchema, await c.req.json().catch(() => ({})));

  if (input.offeredSystems) {
    for (const offered of input.offeredSystems) {
      if (!club.enabledSystems.includes(offered.systemKey)) {
        throw new ValidationError(`System ${offered.systemKey} is not enabled for this club`);
      }
    }
  }

  const updated: GameNight = { ...night, ...input };
  await putNight(updated);
  return c.json({ night: updated });
});
```

> The full `@club-night/shared` import for this file becomes:
> `import { createNightSchema, updateNightSchema } from '@club-night/shared';`
> and the context import becomes:
> `import { requireClubBySlug, requireNight } from './context';`

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: PASS (4 create + 5 update = 9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/organizer-nights.ts packages/api/test/routes/organizer-nights.test.ts
git commit -m "feat(api): add organizer update-night (edit/cancel) endpoint"
```

---

## Task 9: Organizer view-signups endpoint

**Files:**
- Modify: `packages/api/src/routes/organizer-nights.ts`
- Modify: `packages/api/test/routes/organizer-nights.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/organizer-nights.test.ts`**

Append (add `upsertSignup` to imports from `../../src/repositories/signups`):

```ts
import { upsertSignup } from '../../src/repositories/signups';

function listSignups(nightId: string, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/${nightId}/signups`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('GET /clubs/:slug/nights/:nightId/signups (organizer)', () => {
  beforeEach(async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    await upsertSignup({
      nightId: 'night-1',
      clubId: 'club-1',
      playerName: 'Ada',
      email: 'ada@example.com',
      systemKey: 'WARHAMMER_40K',
    });
  });

  it('returns the signups for an organizer', async () => {
    const res = await listSignups('night-1', ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.signups).toHaveLength(1);
    expect(body.signups[0].playerName).toBe('Ada');
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await listSignups('night-1');
    expect(res.status).toBe(401);
  });

  it('404s for an unknown night', async () => {
    const res = await listSignups('missing', ORGANIZER_TOKEN);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify the new tests fail**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: FAIL — the GET signups route is not defined.

- [ ] **Step 3: Add the GET handler to `packages/api/src/routes/organizer-nights.ts`**

Add `listSignupsByNight` to the imports (`import { listSignupsByNight } from '../repositories/signups';`) and append:

```ts
organizerNightRoutes.get('/clubs/:slug/nights/:nightId/signups', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const signups = await listSignupsByNight(night.nightId);
  return c.json({ signups });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: PASS (4 create + 5 update + 3 signups = 12 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New this slice: memberships 2, cognito 2, principal 5, middleware 2, authorize 6, shared night-schemas 8, organizer-nights 12 = **37**. Added to 87 → **124 total**. Typecheck clean for both packages.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/organizer-nights.ts packages/api/test/routes/organizer-nights.test.ts
git commit -m "feat(api): add organizer view-signups endpoint"
```

---

## Done criteria

- `npm test` passes (124 tests: 87 prior + 37 new).
- `npm run typecheck` passes for both packages.
- An organizer (Cognito ID token, OWNER/ORGANIZER membership of the club) can create a night (validated against the club's enabled systems, created OPEN), edit/cancel it, and list its signups. Anonymous callers get 401; non-organizers get 403.
- The `Principal` + `resolvePrincipal` + `authMiddleware` foundation resolves both guest-session and Cognito tokens and is applied app-wide.
- Slice 3c (signup-management endpoints + signup-confirmation email) and 3d (pairing) remain.
- Carry-forward for slice 4 (CDK infra): set `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` env on the Lambda; the Cognito verifier reads `tokenUse: 'id'`.
