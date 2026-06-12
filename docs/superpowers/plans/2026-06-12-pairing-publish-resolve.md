# Pairing Publish, Resolve & Scheduled Handler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer resolve odd-one-out pairings and publish a night's pairings (emailing each matched player their opponent and marking the night `PAIRED`), and provide a `runNightPairing` handler that generates + publishes in one call for the auto-pair-at-deadline schedule.

**Architecture:** A `deletePairing` repo write, a `publishPairings` service (best-effort emails to matched players + night → `PAIRED`, idempotent on night status), a `resolvePairing` service (merge two `NEEDS_RESOLUTION` singles into one `MATCHED` pairing, deleting the absorbed one), organizer-gated publish + resolve endpoints with a night-status guard (generate/resolve blocked once `PAIRED`), and a `runNightPairing` composition. Builds on slice 3d-i and reuses the existing `EmailSender`.

**Tech Stack:** TypeScript, Hono, `@aws-sdk/lib-dynamodb`, zod, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Pairing engine — publish + resolve; § Notifications — pairing published).
**Builds on:** slices 1–3d-i — 174 tests passing. `generatePairings`, the pairings repo, `getEmailSender`/`setEmailSender`, and the nights/signups repos all exist.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Lifecycle decisions (deliberate):**
> - Order is generate → resolve odds → publish. **Publish is the single email trigger.** Resolve happens before publish.
> - **Publish is idempotent on `night.status`:** if the night is already `PAIRED`, publish returns the current state and sends no emails.
> - **Generate and resolve are blocked once the night is `PAIRED`** (409). There is no "unpublish" in the MVP.
> - Players in `NEEDS_RESOLUTION` pairings are NOT emailed by publish (the organizer resolves them first, or handles them offline).
> - Pairing emails are **best-effort** (a failed send is logged, never fails publish), matching the signup-confirmation pattern.

---

## File structure produced by this plan

```
packages/api/
  src/
    repositories/pairings.ts        (MODIFY: add deletePairing)
    services/pairing-service.ts     (MODIFY: add publishPairings, resolvePairing, runNightPairing)
    routes/pairings.ts              (MODIFY: night-PAIRED guard on generate; add publish + resolve routes)
  test/
    repositories/pairings.test.ts   (MODIFY: deletePairing test)
    services/pairing-service.test.ts(MODIFY: publish + resolve + runNightPairing tests)
    routes/pairings.test.ts         (MODIFY: publish + resolve endpoint tests + generate-blocked-when-PAIRED)
```

---

## Task 1: `deletePairing` repository write

**Files:**
- Modify: `packages/api/src/repositories/pairings.ts`
- Modify: `packages/api/test/repositories/pairings.test.ts`

- [ ] **Step 1: Add a failing test to `packages/api/test/repositories/pairings.test.ts`**

Add `deletePairing` to the import from `../../src/repositories/pairings`, then add (inside the existing describe block):

```ts
  it('deletes a single pairing by key', async () => {
    const p1 = pairing({ pairingId: 'p1' });
    await putPairing(p1);
    await putPairing(pairing({ pairingId: 'p2', systemKey: 'BLOOD_BOWL' }));
    await deletePairing(p1);
    const list = await listPairingsByNight('night-1');
    expect(list.map((p) => p.pairingId)).toEqual(['p2']);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/pairings.test.ts`
Expected: FAIL — `deletePairing` is not exported.

- [ ] **Step 3: Add `deletePairing` to `packages/api/src/repositories/pairings.ts`**

(`DeleteCommand` is already imported.) Append:

```ts
export async function deletePairing(pairing: Pairing): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: { PK: pairingPk(pairing.nightId), SK: pairingSk(pairing.systemKey, pairing.pairingId) },
    }),
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/pairings.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/repositories/pairings.ts packages/api/test/repositories/pairings.test.ts
git commit -m "feat(api): add deletePairing repository write"
```

---

## Task 2: `publishPairings` service

**Files:**
- Modify: `packages/api/src/services/pairing-service.ts`
- Modify: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/services/pairing-service.test.ts`**

Add imports at the top (the file already imports `upsertSignup`, `putSignup`, `resetTable`):

```ts
import { putNight, getNight } from '../../src/repositories/nights';
import { putPairing } from '../../src/repositories/pairings';
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';
import { sampleNight } from '../fixtures';
import { publishPairings } from '../../src/services/pairing-service';
```

Then append a describe block:

```ts
describe('publishPairings', () => {
  let email: FakeEmailSender;

  beforeEach(async () => {
    email = new FakeEmailSender();
    setEmailSender(email);
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  });

  afterEach(() => {
    setEmailSender(undefined);
  });

  async function seedMatched() {
    const a = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
    const b = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
    await putPairing({
      pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K',
      players: [{ signupId: a.signupId, playerName: 'Ada' }, { signupId: b.signupId, playerName: 'Bob' }],
      status: 'MATCHED',
    });
  }

  it('emails both matched players and marks the night PAIRED', async () => {
    await seedMatched();
    const result = await publishPairings('club-1', 'night-1');
    expect(result.night.status).toBe('PAIRED');
    expect((await getNight('club-1', 'night-1'))!.status).toBe('PAIRED');
    expect(email.sent).toHaveLength(2);
    const toAda = email.sent.find((m) => m.to === 'a@x.com')!;
    const toBob = email.sent.find((m) => m.to === 'b@x.com')!;
    expect(toAda.text).toContain('Bob');
    expect(toBob.text).toContain('Ada');
  });

  it('is idempotent — a second publish sends no further emails', async () => {
    await seedMatched();
    await publishPairings('club-1', 'night-1');
    await publishPairings('club-1', 'night-1');
    expect(email.sent).toHaveLength(2);
  });

  it('does not email players in NEEDS_RESOLUTION pairings', async () => {
    const c = await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Cy', email: 'c@x.com', systemKey: 'BLOOD_BOWL' });
    await putPairing({
      pairingId: 'odd', nightId: 'night-1', clubId: 'club-1', systemKey: 'BLOOD_BOWL',
      players: [{ signupId: c.signupId, playerName: 'Cy' }], status: 'NEEDS_RESOLUTION',
    });
    const result = await publishPairings('club-1', 'night-1');
    expect(result.night.status).toBe('PAIRED');
    expect(email.sent).toHaveLength(0);
  });

  it('still publishes (PAIRED) when an email send fails', async () => {
    await seedMatched();
    setEmailSender({ send: async () => { throw new Error('SES down'); } });
    const result = await publishPairings('club-1', 'night-1');
    expect(result.night.status).toBe('PAIRED');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: FAIL — `publishPairings` is not exported.

- [ ] **Step 3: Implement `publishPairings` in `packages/api/src/services/pairing-service.ts`**

Add imports and the function (keep the existing `generatePairings`). **Note the existing imports in this file (from slice 3d-i):** it already imports `Signup`/`Pairing`/`PairingPlayer` from `@club-night/shared`, `listSignupsByNight` from `../repositories/signups`, and `putPairing` + `deletePairingsByNight` from `../repositories/pairings`. So:
- **Extend** the existing `@club-night/shared` type import to also include `GameNight`.
- **Extend** the existing `../repositories/pairings` import to also include `listPairingsByNight`.
- `listSignupsByNight` is **already imported** — do NOT add it again.
- **Add** these new imports:

```ts
import type { EmailSender } from '../email/sender';
import { getEmailSender } from '../email/provider';
import { getNight, putNight } from '../repositories/nights';
import { NotFoundError } from '../http/errors';
```

```ts
async function notifyPaired(
  sender: EmailSender,
  to: string | undefined,
  playerName: string,
  opponentName: string,
  systemKey: string,
  night: GameNight,
): Promise<void> {
  if (!to) return;
  try {
    await sender.send({
      to,
      subject: `Your pairing for ${night.title}`,
      text: `Hi ${playerName}, you're paired with ${opponentName} for ${systemKey} at ${night.title}. Good luck!`,
    });
  } catch (err) {
    // Best-effort: a failed pairing email must not fail publishing.
    console.error('Pairing notification email failed', err);
  }
}

/**
 * Publish a night's pairings: email both players of every MATCHED pairing their
 * opponent, then mark the night PAIRED. Idempotent — if the night is already
 * PAIRED, returns current state and sends nothing.
 */
export async function publishPairings(
  clubId: string,
  nightId: string,
): Promise<{ night: GameNight; pairings: Pairing[] }> {
  const night = await getNight(clubId, nightId);
  if (!night) throw new NotFoundError('Game night not found');
  const pairings = await listPairingsByNight(nightId);
  if (night.status === 'PAIRED') {
    return { night, pairings };
  }

  const signups = await listSignupsByNight(nightId);
  const emailBySignupId = new Map(signups.map((s) => [s.signupId, s.email]));
  const sender = getEmailSender();

  for (const pairing of pairings) {
    if (pairing.status !== 'MATCHED' || pairing.players.length !== 2) continue;
    const a = pairing.players[0]!;
    const b = pairing.players[1]!;
    await notifyPaired(sender, emailBySignupId.get(a.signupId), a.playerName, b.playerName, pairing.systemKey, night);
    await notifyPaired(sender, emailBySignupId.get(b.signupId), b.playerName, a.playerName, pairing.systemKey, night);
  }

  const published: GameNight = { ...night, status: 'PAIRED' };
  await putNight(published);
  return { night: published, pairings };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: PASS (3 generate + 4 publish = 7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): add publishPairings service (emails + night PAIRED, idempotent)"
```

---

## Task 3: `resolvePairing` service

**Files:**
- Modify: `packages/api/src/services/pairing-service.ts`
- Modify: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/services/pairing-service.test.ts`**

Add to the imports: `resolvePairing` from the service; `listPairingsByNight` from `../../src/repositories/pairings` (extend the existing import). Then append:

```ts
describe('resolvePairing', () => {
  beforeEach(async () => {
    await putPairing({ pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's1', playerName: 'Ada' }], status: 'NEEDS_RESOLUTION' });
    await putPairing({ pairingId: 'p2', nightId: 'night-1', clubId: 'club-1', systemKey: 'AGE_OF_SIGMAR', players: [{ signupId: 's2', playerName: 'Bob' }], status: 'NEEDS_RESOLUTION' });
  });

  it('merges two unresolved singles into one MATCHED pairing and deletes the absorbed one', async () => {
    const merged = await resolvePairing('night-1', 'p1', 's2');
    expect(merged.status).toBe('MATCHED');
    expect(merged.players.map((p) => p.signupId).sort()).toEqual(['s1', 's2']);
    const remaining = await listPairingsByNight('night-1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.pairingId).toBe('p1');
  });

  it('throws NotFound for an unknown target pairing', async () => {
    await expect(resolvePairing('night-1', 'missing', 's2')).rejects.toMatchObject({ status: 404 });
  });

  it('throws Conflict when the target is already MATCHED', async () => {
    await putPairing({ pairingId: 'p3', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's4', playerName: 'Di' }, { signupId: 's5', playerName: 'Ed' }], status: 'MATCHED' });
    await expect(resolvePairing('night-1', 'p3', 's2')).rejects.toMatchObject({ status: 409 });
  });

  it('throws Validation when the opponent is not another unresolved single', async () => {
    await expect(resolvePairing('night-1', 'p1', 'nobody')).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: FAIL — `resolvePairing` is not exported.

- [ ] **Step 3: Implement `resolvePairing` in `packages/api/src/services/pairing-service.ts`**

Add `ConflictError, ValidationError` to the existing `../http/errors` import and `deletePairing, putPairing` to the existing `../repositories/pairings` import (NotFoundError already imported), then append:

```ts
/**
 * Resolve an odd-one-out: merge the NEEDS_RESOLUTION pairing `pairingId` with
 * another NEEDS_RESOLUTION single (the pairing whose lone player is
 * `opponentSignupId`), producing one MATCHED pairing and deleting the absorbed one.
 */
export async function resolvePairing(
  nightId: string,
  pairingId: string,
  opponentSignupId: string,
): Promise<Pairing> {
  const pairings = await listPairingsByNight(nightId);
  const target = pairings.find((p) => p.pairingId === pairingId);
  if (!target) throw new NotFoundError('Pairing not found');
  if (target.status !== 'NEEDS_RESOLUTION') throw new ConflictError('Pairing is already matched');

  const absorbed = pairings.find(
    (p) =>
      p.status === 'NEEDS_RESOLUTION' &&
      p.pairingId !== target.pairingId &&
      p.players[0]?.signupId === opponentSignupId,
  );
  if (!absorbed) {
    throw new ValidationError('opponentSignupId must be another unresolved player on this night');
  }

  const merged: Pairing = {
    ...target,
    players: [target.players[0]!, absorbed.players[0]!],
    status: 'MATCHED',
  };
  await putPairing(merged);
  await deletePairing(absorbed);
  return merged;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: PASS (3 generate + 4 publish + 4 resolve = 11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): add resolvePairing service (merge two odd-one-out singles)"
```

---

## Task 4: Publish endpoint + block generate when PAIRED

**Files:**
- Modify: `packages/api/src/routes/pairings.ts`
- Modify: `packages/api/test/routes/pairings.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/pairings.test.ts`**

Add imports: `getNight` from `../../src/repositories/nights`, `putNight` from the same, `setEmailSender` from `../../src/email/provider`, `FakeEmailSender` from `../fakes/email`. Then append a `publish` helper and tests, and a generate-blocked test:

```ts
import { getNight, putNight } from '../../src/repositories/nights';
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';

function publish(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/pairings/publish', {
    method: 'POST',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('POST /clubs/:slug/nights/:nightId/pairings/publish', () => {
  it('publishes pairings and marks the night PAIRED for an organizer', async () => {
    const email = new FakeEmailSender();
    setEmailSender(email);
    await generate(ORGANIZER_TOKEN); // 1 MATCHED pairing from the 2 seeded 40k signups
    const res = await publish(ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json() as any).night.status).toBe('PAIRED');
    expect((await getNight('club-1', 'night-1'))!.status).toBe('PAIRED');
    expect(email.sent).toHaveLength(2);
    setEmailSender(undefined);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await publish()).status).toBe(401);
  });

  it('rejects a non-organizer with 403', async () => {
    setCognitoVerifier({ verify: async () => ({ sub: 'stranger', email: 's@x.com' }) });
    expect((await publish(ORGANIZER_TOKEN)).status).toBe(403);
  });
});

describe('POST .../pairings/generate when already PAIRED', () => {
  it('rejects re-generation of a published night with 409', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'PAIRED' }));
    const res = await generate(ORGANIZER_TOKEN);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/pairings.test.ts`
Expected: FAIL — publish route not defined (404) and generate doesn't yet block PAIRED.

- [ ] **Step 3: Add the guard + publish route to `packages/api/src/routes/pairings.ts`**

Add imports: `ConflictError` from `../http/errors`; `publishPairings` from `../services/pairing-service`. In the existing generate handler, after `requireNight`, add the guard; then append the publish route:

```ts
// inside the generate handler, immediately after `const night = await requireNight(...)`:
  if (night.status === 'PAIRED') {
    throw new ConflictError('This night is already published; pairings cannot be regenerated');
  }
```

```ts
pairingRoutes.post('/clubs/:slug/nights/:nightId/pairings/publish', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const result = await publishPairings(club.clubId, night.nightId);
  return c.json(result);
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/pairings.test.ts`
Expected: PASS (the prior pairings-route tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/pairings.ts packages/api/test/routes/pairings.test.ts
git commit -m "feat(api): add publish-pairings endpoint and block generate once PAIRED"
```

---

## Task 5: Resolve endpoint (PATCH a pairing)

**Files:**
- Modify: `packages/api/src/routes/pairings.ts`
- Modify: `packages/api/test/routes/pairings.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/pairings.test.ts`**

Append a `resolve` helper and tests. The night fixture is seeded OPEN in beforeEach; this block seeds two NEEDS_RESOLUTION singles directly:

```ts
import { putPairing } from '../../src/repositories/pairings';

function resolve(pairingId: string, body: unknown, token?: string) {
  return createApp().request(`/clubs/red-dice/nights/night-1/pairings/${pairingId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('PATCH /clubs/:slug/nights/:nightId/pairings/:pairingId', () => {
  beforeEach(async () => {
    await putPairing({ pairingId: 'p1', nightId: 'night-1', clubId: 'club-1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's1', playerName: 'Ada' }], status: 'NEEDS_RESOLUTION' });
    await putPairing({ pairingId: 'p2', nightId: 'night-1', clubId: 'club-1', systemKey: 'BLOOD_BOWL', players: [{ signupId: 's2', playerName: 'Bob' }], status: 'NEEDS_RESOLUTION' });
  });

  it('merges two singles for an organizer', async () => {
    const res = await resolve('p1', { opponentSignupId: 's2' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json() as any).pairing.status).toBe('MATCHED');
  });

  it('rejects a bad opponent with 400', async () => {
    const res = await resolve('p1', { opponentSignupId: 'nobody' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(400);
  });

  it('rejects an anonymous caller with 401', async () => {
    expect((await resolve('p1', { opponentSignupId: 's2' })).status).toBe(401);
  });

  it('rejects resolving on an already-PAIRED night with 409', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'PAIRED' }));
    const res = await resolve('p1', { opponentSignupId: 's2' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/pairings.test.ts`
Expected: FAIL — PATCH route not defined.

- [ ] **Step 3: Add the resolve route to `packages/api/src/routes/pairings.ts`**

Add imports: `z` from `zod`; `parseOrThrow` from `../http/validate`; `resolvePairing` from `../services/pairing-service`. Add the schema and route:

```ts
const resolvePairingSchema = z.object({ opponentSignupId: z.string().trim().min(1) });

pairingRoutes.patch('/clubs/:slug/nights/:nightId/pairings/:pairingId', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  await requireOrganizer(c.get('principal'), club.clubId);
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  if (night.status === 'PAIRED') {
    throw new ConflictError('This night is already published; pairings cannot be resolved');
  }
  const { opponentSignupId } = parseOrThrow(resolvePairingSchema, await c.req.json().catch(() => ({})));
  const pairing = await resolvePairing(night.nightId, c.req.param('pairingId'), opponentSignupId);
  return c.json({ pairing });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/pairings.test.ts`
Expected: PASS (prior + 4 new resolve tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/pairings.ts packages/api/test/routes/pairings.test.ts
git commit -m "feat(api): add resolve-pairing endpoint"
```

---

## Task 6: `runNightPairing` handler (generate + publish)

**Files:**
- Modify: `packages/api/src/services/pairing-service.ts`
- Modify: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Add a failing test to `packages/api/test/services/pairing-service.test.ts`**

Add `runNightPairing` to the service import, then append:

```ts
describe('runNightPairing', () => {
  it('generates and publishes in one call (pairings persisted, night PAIRED, emails sent)', async () => {
    const email = new FakeEmailSender();
    setEmailSender(email);
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
    await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });

    await runNightPairing('club-1', 'night-1');

    expect((await getNight('club-1', 'night-1'))!.status).toBe('PAIRED');
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
    expect(email.sent).toHaveLength(2);
    setEmailSender(undefined);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: FAIL — `runNightPairing` is not exported.

- [ ] **Step 3: Implement `runNightPairing` in `packages/api/src/services/pairing-service.ts`**

Append:

```ts
/**
 * Generate then publish a night's pairings in one call. This is the entry point
 * the auto-pair-at-deadline schedule (slice 4 / EventBridge) invokes.
 */
export async function runNightPairing(clubId: string, nightId: string): Promise<void> {
  await generatePairings(clubId, nightId);
  await publishPairings(clubId, nightId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts`
Expected: PASS (3 generate + 4 publish + 4 resolve + 1 runNightPairing = 12 tests).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New this slice: deletePairing 1, publish service 4, resolve service 4, runNightPairing 1, publish route 3 + generate-blocked 1, resolve route 4 = **18**. Added to 174 → **192 total**. Typecheck clean for both packages.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): add runNightPairing handler for scheduled auto-pairing"
```

---

## Done criteria

- `npm test` passes (192 tests: 174 prior + 18 new).
- `npm run typecheck` passes for both packages.
- An organizer can resolve an odd-one-out (merge two `NEEDS_RESOLUTION` singles into a `MATCHED` pairing), and publish a night — emailing each matched player their opponent (best-effort) and setting the night `PAIRED`. Publish is idempotent; generate and resolve are blocked (409) once `PAIRED`.
- `runNightPairing(clubId, nightId)` composes generate + publish for the slice-4 EventBridge schedule.
- The whole API surface from the spec is now implemented (public reads, guest identity, organizer night CRUD, signup management, pairing generate/view/resolve/publish).
- Carry-forwards for slice 4 (CDK infra): provision Lambda + Function URL, DynamoDB (with TTL on the auth-code `ttl` attribute), Cognito, SES (verified `EMAIL_FROM`), and an EventBridge one-shot schedule per night (created at night-create, firing at `signupDeadline`) that invokes `runNightPairing`. Env: `GUEST_JWT_SECRET`, `EMAIL_FROM`, `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `CLUB_NIGHT_TABLE`, `AWS_REGION`; add a fail-fast cold-start config assertion.
