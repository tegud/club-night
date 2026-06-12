# Signup Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player view, change, or withdraw their own signup (guest by email, or logged-in by userId), let organizers manage any signup in their club, and email a confirmation when a signup is created.

**Architecture:** A `requireSignupAccess` authorization helper (guest-owner | cognito-owner | organizer), a `putSignup` repository write used to update/cancel an existing signup, an `updateSignupSchema`, a new `signup-management` route module (`GET`/`PATCH`/`DELETE` a signup by id, all auth-gated), and a non-blocking signup-confirmation email wired into the existing create-signup route. Builds on slices 1–3b.

**Tech Stack:** TypeScript, Hono, zod, `@aws-sdk/lib-dynamodb`, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ API surface — Signups; § Notifications — signup confirmation).
**Builds on:** slices 1, 2, 3a, 3b — 131 tests passing.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Scope:** signup management + confirmation email only. Pairing is slice 3d; CDK infra is slice 4. Withdraw is a **soft-cancel** (sets `status: 'CANCELLED'`, keeps the record so a re-signup via `upsertSignup` reactivates it). Edits are allowed regardless of night status in this slice (locking edits after `PAIRED` is a slice-3d/future concern).

---

## File structure produced by this plan

```
packages/
  shared/src/schemas.ts              (MODIFY: add updateSignupSchema + UpdateSignupInput)
  api/
    src/
      repositories/signups.ts        (MODIFY: add putSignup; refactor upsertSignup to use it)
      auth/authorize.ts              (MODIFY: add requireSignupAccess)
      routes/signup-management.ts    GET / PATCH / DELETE a signup by id
      routes/signups.ts              (MODIFY: send non-blocking confirmation email on create)
      app.ts                         (MODIFY: mount signupManagementRoutes)
    test/
      fixtures.ts                    (MODIFY: add sampleSignup)
      auth/authorize.test.ts         (MODIFY: requireSignupAccess tests)
      repositories/signups.test.ts   (MODIFY: putSignup test)
      routes/signup-management.test.ts
      routes/signups.test.ts         (MODIFY: confirmation-email tests + fake sender setup)
  shared/test/schemas.test.ts        (MODIFY: updateSignupSchema tests)
```

---

## Task 1: `putSignup` repository write

**Files:**
- Modify: `packages/api/src/repositories/signups.ts`
- Modify: `packages/api/test/repositories/signups.test.ts`

- [ ] **Step 1: Add a failing test to `packages/api/test/repositories/signups.test.ts`**

Add `putSignup` to the import from `../../src/repositories/signups`, then add (inside the existing describe block):

```ts
  it('putSignup overwrites an existing signup by id', async () => {
    const created = await upsertSignup(base);
    await putSignup({ ...created, playerName: 'Ada Lovelace', systemKey: 'BLOOD_BOWL' });
    const fetched = await getSignup('night-1', created.signupId);
    expect(fetched!.playerName).toBe('Ada Lovelace');
    expect(fetched!.systemKey).toBe('BLOOD_BOWL');
    expect(fetched!.signupId).toBe(created.signupId);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/signups.test.ts`
Expected: FAIL — `putSignup` is not exported.

- [ ] **Step 3: Add `putSignup` and refactor `upsertSignup` in `packages/api/src/repositories/signups.ts`**

Add the exported `putSignup` and make `upsertSignup` use it (replace the inline `getDocClient().send(new PutCommand(...))` call in `upsertSignup` with `await putSignup(signup);`):

```ts
export async function putSignup(signup: Signup): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(signup) }));
}
```

The tail of `upsertSignup` becomes:

```ts
  await putSignup(signup);
  return signup;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/signups.test.ts`
Expected: PASS (all prior signup-repo tests + the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/signups.ts packages/api/test/repositories/signups.test.ts
git commit -m "feat(api): add putSignup repository write"
```

---

## Task 2: `requireSignupAccess` authorization helper

**Files:**
- Modify: `packages/api/test/fixtures.ts` (add `sampleSignup`)
- Modify: `packages/api/src/auth/authorize.ts`
- Modify: `packages/api/test/auth/authorize.test.ts`

- [ ] **Step 1: Add a `sampleSignup` fixture to `packages/api/test/fixtures.ts`**

Extend the `@club-night/shared` type import to include `Signup`, then append:

```ts
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
```

- [ ] **Step 2: Add failing tests to `packages/api/test/auth/authorize.test.ts`**

Add imports (`requireSignupAccess` from `../../src/auth/authorize`; `sampleClub`, `sampleSignup`, `sampleMembership` from `../fixtures`; `putMembership` already imported), then append:

```ts
import { requireSignupAccess } from '../../src/auth/authorize';
import { sampleClub, sampleSignup } from '../fixtures';

describe('requireSignupAccess', () => {
  const club = sampleClub(); // clubId 'club-1'
  const signup = sampleSignup(); // clubId 'club-1', email 'ada@example.com', no userId

  it('allows the guest who owns the signup (email + club match)', async () => {
    const guest: Principal = { kind: 'guest', email: 'ada@example.com', clubId: 'club-1' };
    await expect(requireSignupAccess(guest, club, signup)).resolves.toBeUndefined();
  });

  it('forbids a guest of the right club with a different email', async () => {
    const guest: Principal = { kind: 'guest', email: 'bob@example.com', clubId: 'club-1' };
    await expect(requireSignupAccess(guest, club, signup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('forbids a guest whose session is for a different club', async () => {
    const guest: Principal = { kind: 'guest', email: 'ada@example.com', clubId: 'club-2' };
    await expect(requireSignupAccess(guest, club, signup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows a logged-in player who owns the signup (userId match)', async () => {
    const owned = sampleSignup({ userId: 'user-9' });
    const principal: Principal = { kind: 'cognito', userId: 'user-9' };
    await expect(requireSignupAccess(principal, club, owned)).resolves.toBeUndefined();
  });

  it('allows an organizer to manage any signup in their club', async () => {
    await putMembership(sampleMembership({ userId: 'org-1', role: 'ORGANIZER' }));
    const principal: Principal = { kind: 'cognito', userId: 'org-1' };
    await expect(requireSignupAccess(principal, club, signup)).resolves.toBeUndefined();
  });

  it('forbids a cognito user who is neither the owner nor an organizer', async () => {
    const principal: Principal = { kind: 'cognito', userId: 'stranger' };
    await expect(requireSignupAccess(principal, club, signup)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('throws Unauthorized when there is no principal', async () => {
    await expect(requireSignupAccess(undefined, club, signup)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
```

> Note: `resetTable()` already runs in this file's `beforeEach` (from the slice-3b `requireOrganizer` tests), so the membership seed is isolated per test.

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/authorize.test.ts`
Expected: FAIL — `requireSignupAccess` is not exported.

- [ ] **Step 4: Implement `requireSignupAccess` in `packages/api/src/auth/authorize.ts`**

Add the imports (`Club, Signup` types from `@club-night/shared`) and append:

```ts
import type { Club, Signup } from '@club-night/shared';

/**
 * Require that the principal may manage this signup: the guest who owns it
 * (email + club match), the logged-in player who owns it (userId match), or an
 * organizer of the club. Throws Unauthorized (no principal) or Forbidden.
 */
export async function requireSignupAccess(
  principal: Principal | undefined,
  club: Club,
  signup: Signup,
): Promise<void> {
  if (!principal) throw new UnauthorizedError('Sign-in required');

  if (principal.kind === 'guest') {
    if (principal.clubId === signup.clubId && principal.email === signup.email) return;
    throw new ForbiddenError('You can only manage your own signup');
  }

  // cognito: owner by userId, otherwise must be an organizer of the club
  if (signup.userId && signup.userId === principal.userId) return;
  await requireOrganizer(principal, club.clubId);
}
```

> `requireOrganizer` is already in this file. Its `Membership` return value is ignored here (we only need it to throw-or-pass).

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/authorize.test.ts`
Expected: PASS (6 requireOrganizer + 7 requireSignupAccess = 13 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/auth/authorize.ts packages/api/test/auth/authorize.test.ts packages/api/test/fixtures.ts
git commit -m "feat(api): add requireSignupAccess authorization helper"
```

---

## Task 3: `updateSignupSchema`

**Files:**
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/test/schemas.test.ts`

- [ ] **Step 1: Add failing tests to `packages/shared/test/schemas.test.ts`**

Add `updateSignupSchema` to the imports, then append:

```ts
describe('updateSignupSchema', () => {
  it('accepts a system change', () => {
    expect(updateSignupSchema.parse({ systemKey: 'BLOOD_BOWL' })).toEqual({ systemKey: 'BLOOD_BOWL' });
  });

  it('accepts a note change', () => {
    expect(updateSignupSchema.parse({ note: 'Bringing Orks' })).toEqual({ note: 'Bringing Orks' });
  });

  it('accepts an empty (no-op) update', () => {
    expect(updateSignupSchema.parse({})).toEqual({});
  });

  it('rejects an unknown system', () => {
    expect(() => updateSignupSchema.parse({ systemKey: 'CHESS' })).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/shared/test/schemas.test.ts`
Expected: FAIL — `updateSignupSchema` is not exported.

- [ ] **Step 3: Implement in `packages/shared/src/schemas.ts`**

Append:

```ts
export const updateSignupSchema = z.object({
  systemKey: z.enum(GAME_SYSTEM_KEYS).optional(),
  note: z.string().trim().max(500).optional(),
});
export type UpdateSignupInput = z.infer<typeof updateSignupSchema>;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/shared/test/schemas.test.ts`
Expected: PASS (all prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/test/schemas.test.ts
git commit -m "feat(shared): add updateSignupSchema"
```

---

## Task 4: GET a signup by id

**Files:**
- Create: `packages/api/src/routes/signup-management.ts`
- Modify: `packages/api/src/app.ts` (mount the routes)
- Test: `packages/api/test/routes/signup-management.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/routes/signup-management.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub, sampleNight, sampleMembership } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { putNight } from '../../src/repositories/nights';
import { putMembership } from '../../src/repositories/memberships';
import { upsertSignup } from '../../src/repositories/signups';
import { issueGuestSession } from '../../src/auth/guest-session';
import { setCognitoVerifier } from '../../src/auth/cognito';
import { createApp } from '../../src/app';

const ORGANIZER_TOKEN = 'organizer-token';
let signupId: string;

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
  await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  await putMembership(sampleMembership({ userId: 'user-1', role: 'OWNER' }));
  const signup = await upsertSignup({
    nightId: 'night-1',
    clubId: 'club-1',
    playerName: 'Ada',
    email: 'ada@example.com',
    systemKey: 'WARHAMMER_40K',
  });
  signupId = signup.signupId;
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

async function guestToken(email: string, clubId = 'club-1') {
  return issueGuestSession({ email, clubId });
}

function get(id: string, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/signups/${id}`, {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('GET /clubs/:slug/nights/:nightId/signups/:signupId', () => {
  it('returns the signup to its guest owner', async () => {
    const res = await get(signupId, await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.playerName).toBe('Ada');
  });

  it('returns the signup to an organizer', async () => {
    const res = await get(signupId, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
  });

  it('forbids a different guest with 403', async () => {
    const res = await get(signupId, await guestToken('bob@example.com'));
    expect(res.status).toBe(403);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await get(signupId);
    expect(res.status).toBe(401);
  });

  it('404s for an unknown signup', async () => {
    const res = await get('missing', await guestToken('ada@example.com'));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/signup-management`.

- [ ] **Step 3: Implement `packages/api/src/routes/signup-management.ts` (GET + shared `loadSignup` only)**

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Club, GameNight, Signup } from '@club-night/shared';
import type { AppEnv } from '../auth/middleware';
import { requireClubBySlug, requireNight } from './context';
import { requireSignupAccess } from '../auth/authorize';
import { NotFoundError } from '../http/errors';
import { getSignup } from '../repositories/signups';

export const signupManagementRoutes = new Hono<AppEnv>();

async function loadSignup(c: Context<AppEnv>): Promise<{ club: Club; night: GameNight; signup: Signup }> {
  const club = await requireClubBySlug(c.req.param('slug'));
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const signup = await getSignup(night.nightId, c.req.param('signupId'));
  if (!signup) throw new NotFoundError('Signup not found');
  return { club, night, signup };
}

signupManagementRoutes.get('/clubs/:slug/nights/:nightId/signups/:signupId', async (c) => {
  const { club, signup } = await loadSignup(c);
  await requireSignupAccess(c.get('principal'), club, signup);
  return c.json({ signup });
});
```

> Only the GET handler is implemented in this task. The PATCH and DELETE handlers (which reuse `loadSignup`) are added with their own failing tests in Tasks 5 and 6. `loadSignup` returns `night` even though GET ignores it — PATCH needs it.

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

  return app;
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: PASS (5 GET tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/signup-management.ts packages/api/src/app.ts packages/api/test/routes/signup-management.test.ts
git commit -m "feat(api): add GET signup-by-id endpoint with owner/organizer access"
```

---

## Task 5: PATCH a signup (change system / note)

**Files:**
- Modify: `packages/api/test/routes/signup-management.test.ts`
- (Handler already implemented in Task 4.)

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/signup-management.test.ts`**

Add `getSignup` to the imports from `../../src/repositories/signups`, then append a `patch` helper and a describe block:

```ts
import { getSignup } from '../../src/repositories/signups';

function patch(id: string, body: unknown, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/signups/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('PATCH /clubs/:slug/nights/:nightId/signups/:signupId', () => {
  it('lets the guest owner change their system', async () => {
    const res = await patch(signupId, { systemKey: 'BLOOD_BOWL' }, await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.systemKey).toBe('BLOOD_BOWL');
    expect((await getSignup('night-1', signupId))!.systemKey).toBe('BLOOD_BOWL');
  });

  it('rejects a system the night does not offer with 400', async () => {
    const res = await patch(signupId, { systemKey: 'AGE_OF_SIGMAR' }, await guestToken('ada@example.com'));
    expect(res.status).toBe(400);
  });

  it('forbids a different guest with 403', async () => {
    const res = await patch(signupId, { note: 'x' }, await guestToken('bob@example.com'));
    expect(res.status).toBe(403);
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await patch(signupId, { note: 'x' });
    expect(res.status).toBe(401);
  });
});
```

> The night fixture offers `WARHAMMER_40K` + `BLOOD_BOWL`, so `AGE_OF_SIGMAR` is valid-in-the-enum but not offered.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: FAIL — no PATCH handler is registered (PATCH returns 404, not the expected statuses).

- [ ] **Step 3: Add the PATCH handler to `packages/api/src/routes/signup-management.ts`**

Add these imports to the file (`updateSignupSchema` from `@club-night/shared`; `parseOrThrow` from `../http/validate`; `ValidationError` alongside the existing `NotFoundError` import; `putSignup` alongside the existing `getSignup` import), then append the handler:

```ts
signupManagementRoutes.patch('/clubs/:slug/nights/:nightId/signups/:signupId', async (c) => {
  const { club, night, signup } = await loadSignup(c);
  await requireSignupAccess(c.get('principal'), club, signup);
  const input = parseOrThrow(updateSignupSchema, await c.req.json().catch(() => ({})));
  if (input.systemKey && !night.offeredSystems.some((s) => s.systemKey === input.systemKey)) {
    throw new ValidationError(`System ${input.systemKey} is not offered on this night`);
  }
  const updated: Signup = { ...signup, ...input };
  await putSignup(updated);
  return c.json({ signup: updated });
});
```

The relevant imports become:
```ts
import { updateSignupSchema } from '@club-night/shared';
import { parseOrThrow } from '../http/validate';
import { NotFoundError, ValidationError } from '../http/errors';
import { getSignup, putSignup } from '../repositories/signups';
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: PASS (5 GET + 4 PATCH = 9 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/signup-management.ts packages/api/test/routes/signup-management.test.ts
git commit -m "feat(api): add PATCH signup endpoint"
```

---

## Task 6: DELETE a signup (withdraw = soft-cancel)

**Files:**
- Modify: `packages/api/test/routes/signup-management.test.ts`
- (Handler already implemented in Task 4.)

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/signup-management.test.ts`**

Append a `del` helper and a describe block:

```ts
function del(id: string, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/signups/${id}`, {
    method: 'DELETE',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('DELETE /clubs/:slug/nights/:nightId/signups/:signupId', () => {
  it('soft-cancels the signup for its guest owner', async () => {
    const res = await del(signupId, await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.status).toBe('CANCELLED');
    expect((await getSignup('night-1', signupId))!.status).toBe('CANCELLED');
  });

  it('lets an organizer cancel any signup', async () => {
    const res = await del(signupId, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await getSignup('night-1', signupId))!.status).toBe('CANCELLED');
  });

  it('rejects an anonymous caller with 401', async () => {
    const res = await del(signupId);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: FAIL — no DELETE handler is registered.

- [ ] **Step 3: Add the DELETE handler to `packages/api/src/routes/signup-management.ts`**

`putSignup` is already imported (from Task 5). Append:

```ts
signupManagementRoutes.delete('/clubs/:slug/nights/:nightId/signups/:signupId', async (c) => {
  const { club, signup } = await loadSignup(c);
  await requireSignupAccess(c.get('principal'), club, signup);
  const cancelled: Signup = { ...signup, status: 'CANCELLED' };
  await putSignup(cancelled);
  return c.json({ signup: cancelled });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: PASS (5 GET + 4 PATCH + 3 DELETE = 12 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/signup-management.ts packages/api/test/routes/signup-management.test.ts
git commit -m "feat(api): add DELETE (withdraw) signup endpoint"
```

---

## Task 7: Signup-confirmation email on create (non-blocking)

**Files:**
- Modify: `packages/api/src/routes/signups.ts`
- Modify: `packages/api/test/routes/signups.test.ts`

- [ ] **Step 1: Update the create-signup tests in `packages/api/test/routes/signups.test.ts`**

Add the fake-sender wiring and two confirmation assertions. At the top, add imports:

```ts
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';
```

Change the `beforeEach` to also install a fake sender, and add an `afterEach` reset. Replace the existing `beforeEach`:

```ts
let email: FakeEmailSender;

beforeEach(async () => {
  await resetTable();
  await putClub(sampleClub());
  email = new FakeEmailSender();
  setEmailSender(email);
});

afterEach(() => {
  setEmailSender(undefined);
});
```

Then add, inside the `describe('POST ...signups', ...)` block:

```ts
  it('emails a confirmation to the player on signup', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    await post(validBody);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ada@example.com');
    expect(email.sent[0]!.subject).toContain('Thursday Night Gaming');
  });

  it('still succeeds (201) when the confirmation email fails', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    setEmailSender({ send: async () => { throw new Error('SES down'); } });
    const res = await post(validBody);
    expect(res.status).toBe(201);
    expect(await listSignupsByNight('night-1')).toHaveLength(1);
  });
```

> `validBody` uses `email: 'Ada@Example.com'` (lowercased to `ada@example.com` by the schema) and `sampleNight` has title `'Thursday Night Gaming'`. `listSignupsByNight` is already imported in this file.

- [ ] **Step 2: Run it to verify the new tests fail**

Run: `npx vitest run packages/api/test/routes/signups.test.ts`
Expected: FAIL — no confirmation email is sent yet (`email.sent` is empty).

- [ ] **Step 3: Send the confirmation in `packages/api/src/routes/signups.ts`**

Add the import `import { getEmailSender } from '../email/provider';`, then after the `upsertSignup(...)` call and before the `return`, send a non-blocking confirmation:

```ts
  try {
    await getEmailSender().send({
      to: signup.email,
      subject: `You're signed up for ${night.title}`,
      text: `Hi ${signup.playerName}, you're confirmed to play ${signup.systemKey} at ${night.title}. To change or withdraw your signup, return to the club page and request a sign-in code.`,
    });
  } catch (err) {
    // Email is best-effort: a signup must not fail because confirmation didn't send.
    console.error('Signup confirmation email failed', err);
  }

  return c.json({ signup }, 201);
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/signups.test.ts`
Expected: PASS (the prior signup-route tests + 2 new confirmation tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New this slice: putSignup 1, requireSignupAccess 7, updateSignupSchema 4, signup-management 12, signup confirmation 2 = **26**. Added to 131 → **157 total**. Typecheck clean for both packages.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/signups.ts packages/api/test/routes/signups.test.ts
git commit -m "feat(api): email a confirmation on signup (non-blocking)"
```

---

## Done criteria

- `npm test` passes (157 tests: 131 prior + 26 new).
- `npm run typecheck` passes for both packages.
- A guest (with a guest-session token) can view, change the system/note of, and withdraw their own signup; a different guest is forbidden (403); an organizer can manage any signup in their club; anonymous callers get 401.
- Withdraw is a soft-cancel (`status: 'CANCELLED'`); creating again with the same email reactivates the record via `upsertSignup`.
- Creating a signup emails a best-effort confirmation; a failing send does not fail the signup.
- Carry-forwards: editing a signup is not locked after pairing (slice 3d / future); logged-in players signing up with a `userId` attached is not yet wired into the create route (the `requireSignupAccess` userId-owner branch is ready and tested via seeded data).
- Slice 3d (pairing) and slice 4 (CDK infra) remain.
