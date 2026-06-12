# Two-Phase Pairing Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pairing two-phase: generating pairings closes signups (`OPEN → CLOSED`) and notifies the organizer; players are emailed only when the organizer publishes (`CLOSED → PAIRED`). The deadline handler generates + notifies the organizer (it no longer auto-publishes).

**Architecture:** Three changes to the pairing service: `generatePairings` now transitions the night to `CLOSED`; `publishPairings` now requires the night to be `CLOSED`; and the scheduled handler (renamed `runDeadlinePairing`) does generate + notify-organizer instead of generate + publish. Adds an organizer "pairings ready" email. This evolves slices 3d-i / 3d-ii per the owner's chosen flow.

**Tech Stack:** TypeScript, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Game night lifecycle — two-phase pairing).
**Builds on:** slices 1–3d-ii — 194 tests passing.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **This slice EVOLVES existing code and UPDATES existing tests** (it is not purely additive). Several slice-3d-i/3d-ii tests assumed "generate doesn't change night status" and "publish works from OPEN" — those assumptions change here and their tests must be updated as part of the relevant task (the plan calls out exactly which).

> **Lifecycle after this slice:** `OPEN` --(generate)--> `CLOSED` --(publish)--> `PAIRED`. Generate closes signups; publish emails players. Generate and resolve remain blocked (409) once `PAIRED` (route guards, unchanged). Publish is idempotent on `PAIRED`.

---

## File structure touched by this plan

```
packages/api/
  src/services/pairing-service.ts        (MODIFY: generatePairings sets CLOSED; publishPairings requires CLOSED; rename runNightPairing → runDeadlinePairing + notifyOrganizerPairingsReady)
  test/services/pairing-service.test.ts  (MODIFY: generate tests seed a night + assert CLOSED; publish tests seed CLOSED; runNightPairing test → runDeadlinePairing two-phase test)
```

No route changes are needed: the generate route already calls `generatePairings` and the publish route already calls `publishPairings`; the publish-route test already calls generate before publish, so the `OPEN → CLOSED → PAIRED` flow works through the existing endpoints unchanged.

---

## Task 1: `generatePairings` closes signups (`OPEN → CLOSED`)

**Files:**
- Modify: `packages/api/src/services/pairing-service.ts`
- Modify: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Update the `generatePairings` test setup + add a CLOSED assertion**

In the `describe('generatePairings', ...)` block of `packages/api/test/services/pairing-service.test.ts`:
- Ensure a night exists (generate now loads it). Add to that block's `beforeEach` (or create one if it only relies on the file-level resetTable): seed an OPEN night. The block already imports / can import `putNight`, `getNight`, `sampleNight` (these are imported by the publish block in the same file — reuse them). Add:
  ```ts
  await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
  ```
  (Put this in a `beforeEach` inside the generatePairings describe block, after the file-level `resetTable`.)
- Add a new test asserting generate closes signups:
  ```ts
  it('closes signups (sets the night CLOSED) when generating', async () => {
    await seed('a@x.com', 'WARHAMMER_40K');
    await seed('b@x.com', 'WARHAMMER_40K');
    await generatePairings('club-1', 'night-1', identityShuffle);
    expect((await getNight('club-1', 'night-1'))!.status).toBe('CLOSED');
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts -t generatePairings`
Expected: FAIL — generate does not set CLOSED yet (and/or the new night-load throws if the existing tests didn't seed a night — that's why Step 1 adds the seed).

- [ ] **Step 3: Make `generatePairings` load the night and set it CLOSED**

In `packages/api/src/services/pairing-service.ts`, update `generatePairings` to load the night (throw `NotFoundError` if missing) and transition it to `CLOSED` after persisting pairings. `getNight`, `putNight`, and `NotFoundError` are already imported (used by `publishPairings`). The function becomes:

```ts
export async function generatePairings(
  clubId: string,
  nightId: string,
  shuffle: Shuffle = fisherYatesShuffle,
): Promise<Pairing[]> {
  const night = await getNight(clubId, nightId);
  if (!night) throw new NotFoundError('Game night not found');

  const confirmed = (await listSignupsByNight(nightId)).filter((s) => s.status === 'CONFIRMED');
  const { pairings, unpaired } = pairNight(confirmed, shuffle);

  const result: Pairing[] = [];
  for (const p of pairings) {
    result.push({ pairingId: ulid(), nightId, clubId, systemKey: p.systemKey, players: p.players.map(toPlayer), status: 'MATCHED' });
  }
  for (const signup of unpaired) {
    result.push({ pairingId: ulid(), nightId, clubId, systemKey: signup.systemKey, players: [toPlayer(signup)], status: 'NEEDS_RESOLUTION' });
  }

  await deletePairingsByNight(nightId);
  for (const pairing of result) {
    await putPairing(pairing);
  }

  // Generating pairings closes signups (two-phase: CLOSED → publish → PAIRED).
  if (night.status !== 'CLOSED') {
    await putNight({ ...night, status: 'CLOSED' });
  }
  return result;
}
```

(Keep the existing `toPlayer` helper. This preserves the existing generate behaviour — CONFIRMED filter, clear-then-persist, injectable shuffle — and only adds the night load + CLOSED transition.)

- [ ] **Step 4: Run the generate tests to verify they pass**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts -t generatePairings`
Expected: PASS (the 3 existing generate tests + the new CLOSED test).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): generating pairings closes signups (OPEN -> CLOSED)"
```

---

## Task 2: `publishPairings` requires `CLOSED`

**Files:**
- Modify: `packages/api/src/services/pairing-service.ts`
- Modify: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Update the publish tests to seed CLOSED + add an OPEN-rejection test**

In the `describe('publishPairings', ...)` block of `packages/api/test/services/pairing-service.test.ts`:
- Change the block's `beforeEach` seed from `status: 'OPEN'` to `status: 'CLOSED'` (publish now runs on a CLOSED night):
  ```ts
  await putNight(sampleNight({ nightId: 'night-1', status: 'CLOSED' }));
  ```
- Add a test that publishing an OPEN night is rejected:
  ```ts
  it('rejects publishing a night that has not been generated/closed yet', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    await expect(publishPairings('club-1', 'night-1')).rejects.toMatchObject({ status: 409 });
  });
  ```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts -t publishPairings`
Expected: FAIL — the new OPEN-rejection test fails (publish currently accepts non-PAIRED nights including OPEN). The other publish tests (now seeding CLOSED) should still pass once Step 3 lands.

- [ ] **Step 3: Add the CLOSED guard to `publishPairings`**

In `publishPairings`, after the idempotency check, reject non-CLOSED nights. `ConflictError` is already imported (used by `resolvePairing`). The status checks become:

```ts
  if (night.status === 'PAIRED') {
    return { night, pairings };
  }
  if (night.status !== 'CLOSED') {
    throw new ConflictError('Generate pairings before publishing');
  }
```

(Place this immediately after the `const pairings = await listPairingsByNight(nightId);` line, replacing the existing lone `if (night.status === 'PAIRED') { return { night, pairings }; }`.)

- [ ] **Step 4: Run the publish tests to verify they pass**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts -t publishPairings`
Expected: PASS (all existing publish tests, now seeding CLOSED, + the new OPEN-rejection test).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): publishPairings requires a CLOSED night"
```

---

## Task 3: Deadline handler — generate + notify organizer (rename `runNightPairing` → `runDeadlinePairing`)

**Files:**
- Modify: `packages/api/src/services/pairing-service.ts`
- Modify: `packages/api/test/services/pairing-service.test.ts`

- [ ] **Step 1: Replace the `runNightPairing` test with a two-phase `runDeadlinePairing` test**

In `packages/api/test/services/pairing-service.test.ts`, replace the entire `describe('runNightPairing', ...)` block with:

```ts
describe('runDeadlinePairing', () => {
  let email: FakeEmailSender;

  beforeEach(async () => {
    email = new FakeEmailSender();
    setEmailSender(email);
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN', createdBy: 'user-1' }));
    await putMembership(sampleMembership({ clubId: 'club-1', userId: 'user-1', role: 'OWNER', email: 'olivia@example.com' }));
    await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
    await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
  });

  afterEach(() => {
    setEmailSender(undefined);
  });

  it('generates, closes the night, and notifies the organizer (no player emails)', async () => {
    await runDeadlinePairing('club-1', 'night-1');

    expect((await getNight('club-1', 'night-1'))!.status).toBe('CLOSED');
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('olivia@example.com');
    expect(email.sent.some((m) => m.to === 'a@x.com' || m.to === 'b@x.com')).toBe(false);
  });
});
```

Add `putMembership` (from `../../src/repositories/memberships`) and `sampleMembership` (from `../fixtures`) to the imports if not already present, and ensure `runNightPairing` is replaced by `runDeadlinePairing` in the service import.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts -t runDeadlinePairing`
Expected: FAIL — `runDeadlinePairing` is not exported (and `runNightPairing` is being removed).

- [ ] **Step 3: Replace `runNightPairing` with `runDeadlinePairing` + add the organizer notification**

In `packages/api/src/services/pairing-service.ts`: add `import { getMembership } from '../repositories/memberships';`. Remove the old `runNightPairing` and add:

```ts
async function notifyOrganizerPairingsReady(clubId: string, nightId: string): Promise<void> {
  const night = await getNight(clubId, nightId);
  if (!night) return;
  const organizer = await getMembership(clubId, night.createdBy);
  if (!organizer) return;
  try {
    await getEmailSender().send({
      to: organizer.email,
      subject: `Pairings ready to review for ${night.title}`,
      text: `Pairings for ${night.title} have been generated and signups are now closed. Review them, resolve any unpaired players, and publish when ready — players are notified on publish.`,
    });
  } catch (err) {
    // Best-effort: a failed organizer notification must not fail the deadline run.
    console.error('Organizer pairings-ready email failed', err);
  }
}

/**
 * The auto-pair-at-deadline entry point (invoked by the slice-4 EventBridge schedule).
 * Generates pairings (which closes signups → CLOSED) and notifies the organizer to
 * review and publish. It deliberately does NOT publish — players are emailed only when
 * the organizer publishes.
 */
export async function runDeadlinePairing(clubId: string, nightId: string): Promise<void> {
  await generatePairings(clubId, nightId);
  await notifyOrganizerPairingsReady(clubId, nightId);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/services/pairing-service.test.ts -t runDeadlinePairing`
Expected: PASS (1 test).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. Net change vs the prior 194: generate gains 1 test (CLOSED), publish gains 1 test (OPEN-rejection), the runNightPairing test is replaced 1-for-1 by runDeadlinePairing → **196 total**. Typecheck clean for both packages. Confirm no remaining reference to `runNightPairing` anywhere (grep).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/pairing-service.ts packages/api/test/services/pairing-service.test.ts
git commit -m "feat(api): deadline handler generates + notifies organizer (two-phase, no auto-publish)"
```

---

## Done criteria

- `npm test` passes (~196 tests) and `npm run typecheck` is clean for both packages.
- Generating pairings (manual endpoint or the deadline handler) transitions the night `OPEN → CLOSED`, closing signups.
- `publishPairings` only runs on a `CLOSED` night (OPEN → 409; PAIRED → idempotent), transitioning `CLOSED → PAIRED` and emailing the matched players.
- `runDeadlinePairing(clubId, nightId)` generates + notifies the organizer (no player emails); it is the slice-4 EventBridge entry point.
- The two-phase journey holds end to end: organizer (or deadline) generates → night CLOSED + organizer notified → organizer resolves odds → organizer publishes → night PAIRED + players emailed. `CLOSED` is now a meaningful, reachable state.
- Carry-forward for slice 4 (CDK): the EventBridge schedule invokes `runDeadlinePairing(clubId, nightId)` at the night's `signupDeadline`; it must supply both ids (per-night schedule or a due-nights sweeper — no "find due nights" query exists yet).
