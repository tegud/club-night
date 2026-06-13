# Frontend Pairings UI Implementation Plan (slice 5d-iii — final)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in organizer the per-night pairings workflow at `/c/:slug/nights/:nightId/organize`: **generate** random within-system pairings, **resolve** any odd-ones-out (merge two unpaired players), and **publish** (emails players, marks the night PAIRED). This is the last slice — it completes the product.

**Architecture:** Four new `apiClient` pairing methods (unwrapping the API's `{ pairings }` / `{ pairing }` / `{ night, pairings }` envelopes, mirroring `listNights`/`getNight`), a `usePairings` query hook, and a `PairingsPage` driven by the night's status:
- `OPEN` → show **Generate pairings** (POST `…/pairings/generate`; this closes signups → `CLOSED`).
- `CLOSED` → show the pairings; MATCHED rows list both players + system; each NEEDS_RESOLUTION row offers a dropdown of the *other* unresolved players + **Resolve** (PATCH); a **Publish** button is shown (with a warning if any NEEDS_RESOLUTION remain). Generate is also available as a **Re-roll**.
- `PAIRED` → read-only "Published" view of the pairings.

**Tech Stack:** React 18, React Router, TanStack Query, Vitest + jsdom + testing-library.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Frontend; two-phase pairing lifecycle OPEN → CLOSED → PAIRED).
**Builds on:** slice 5d-ii (organizer dashboard, 271 tests). The dashboard's per-night **Pairings** link already targets `/c/:slug/nights/:nightId/organize` — this slice registers that route.

**API contract (already implemented in `packages/api/src/routes/pairings.ts`):**
- `GET  /clubs/:slug/nights/:nightId/pairings` → `{ pairings: Pairing[] }`
- `POST /clubs/:slug/nights/:nightId/pairings/generate` → `{ pairings: Pairing[] }` (201); 409 if night already `PAIRED`.
- `PATCH /clubs/:slug/nights/:nightId/pairings/:pairingId` body `{ opponentSignupId }` → `{ pairing: Pairing }`; 409 if `PAIRED`, 422 if opponent not another unresolved player.
- `POST /clubs/:slug/nights/:nightId/pairings/publish` → `{ night: GameNight, pairings: Pairing[] }`; 409 if not yet `CLOSED`.

A `Pairing` (`@club-night/shared`) is `{ pairingId, nightId, clubId, systemKey, players: PairingPlayer[], status }` where `PairingPlayer = { signupId, playerName }`, `status ∈ {'MATCHED','NEEDS_RESOLUTION'}`. MATCHED has 2 players; NEEDS_RESOLUTION has 1.

> **Commit note:** TDD with frequent commits. The owner commits; skip every "Commit" step.

> **Design:** reuse `.card`/`.container`/`--club-accent`, the accent-button style, and the login gate + sign-out pattern from `OrganizerPage`. Surface errors via `lib/errors.ts` `errorMessage` (with any 403 override).

---

## File structure produced by this plan

```
packages/frontend/src/
  api/client.ts                    (MODIFY: add listPairings/generatePairings/resolvePairing/publishPairings)
  api/types.ts                     (MODIFY: add PairingsResponse/PairingResponse/PublishResponse)
  club/useClub.ts                  (MODIFY: add usePairings hook)
  pages/PairingsPage.tsx           new
  App.tsx                          (MODIFY: register nights/:nightId/organize route)
packages/frontend/test/
  api/client.test.ts               (MODIFY: add pairing-method tests)
  pages/PairingsPage.test.tsx      new
```

---

## Task 1: pairing client methods + `usePairings` hook

**Files:**
- Modify: `packages/frontend/src/api/types.ts`, `packages/frontend/src/api/client.ts`, `packages/frontend/src/club/useClub.ts`
- Test: `packages/frontend/test/api/client.test.ts`

- [ ] **Step 1: Add response envelope types to `api/types.ts`**

```ts
import type { Club, GameNight, Pairing } from '@club-night/shared';
// ...existing...
export interface PairingsResponse {
  pairings: Pairing[];
}
export interface PairingResponse {
  pairing: Pairing;
}
export interface PublishResponse {
  night: GameNight;
  pairings: Pairing[];
}
```

- [ ] **Step 2: Write the failing tests — append to `packages/frontend/test/api/client.test.ts`**

Match the existing fetch-mocking style in that file (it mocks `global.fetch`). Add a `describe('pairings', ...)` block with tests asserting:

1. `listPairings('red-dice', 'n1')` GETs `/clubs/red-dice/nights/n1/pairings` and returns the unwrapped `pairings` array.
2. `generatePairings('red-dice', 'n1')` POSTs `/clubs/red-dice/nights/n1/pairings/generate` and returns the unwrapped `pairings` array (mock a 201 with `{ pairings: [...] }`).
3. `resolvePairing('red-dice', 'n1', 'p1', 'sig9')` PATCHes `/clubs/red-dice/nights/n1/pairings/p1` with body `{ opponentSignupId: 'sig9' }` and returns the unwrapped `pairing`.
4. `publishPairings('red-dice', 'n1')` POSTs `/clubs/red-dice/nights/n1/pairings/publish` and returns `{ night, pairings }`.

Use a sample `Pairing` like `{ pairingId: 'p1', nightId: 'n1', clubId: 'c1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's1', playerName: 'Ada' }, { signupId: 's2', playerName: 'Ben' }], status: 'MATCHED' }`. Assert the request method/path/body via the `fetch` mock's call args, mirroring how the existing tests in this file assert (check the file for the exact helper/assertion idiom before writing).

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: FAIL — methods don't exist.

- [ ] **Step 4: Implement the methods in `packages/frontend/src/api/client.ts`**

Add to the `apiClient` object (mirror the unwrap style of `listNights`/`getNight`). Import the new envelope types and `Pairing`:

```ts
  async listPairings(slug: string, nightId: string) {
    const res = await request<PairingsResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings`);
    return res.pairings;
  },
  async generatePairings(slug: string, nightId: string) {
    const res = await request<PairingsResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings/generate`, { method: 'POST' });
    return res.pairings;
  },
  async resolvePairing(slug: string, nightId: string, pairingId: string, opponentSignupId: string) {
    const res = await request<PairingResponse>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings/${encodeURIComponent(pairingId)}`,
      { method: 'PATCH', body: JSON.stringify({ opponentSignupId }) },
    );
    return res.pairing;
  },
  async publishPairings(slug: string, nightId: string): Promise<PublishResponse> {
    return request<PublishResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/pairings/publish`, { method: 'POST' });
  },
```

- [ ] **Step 5: Add the `usePairings` hook to `packages/frontend/src/club/useClub.ts`**

```ts
export function usePairings(slug: string, nightId: string, enabled = true) {
  return useQuery({ queryKey: ['pairings', slug, nightId], queryFn: () => apiClient.listPairings(slug, nightId), enabled });
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: PASS (existing 16 + 4 new = 20).

---

## Task 2: `PairingsPage` + route

**Files:**
- Create: `packages/frontend/src/pages/PairingsPage.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/test/pages/PairingsPage.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/pages/PairingsPage.test.tsx`**

Follow the `OrganizerPage.test.tsx` idiom: a `renderPage()` helper rendering `<PairingsPage />` inside a router at `/c/red-dice/nights/n1/organize` with a matching `<Route path="/c/:slug/nights/:nightId/organize">`, using `renderWithProviders`. Set a token via `setToken('id-token-123')` in `beforeEach` so the page is past the login gate. Mock `apiClient.getNight` + `apiClient.listPairings`.

Cover:

```tsx
// helpers / fixtures
const openNight: GameNight = { nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT', pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [], createdBy: 'u1' };
const closedNight = { ...openNight, status: 'CLOSED' as const };
const pairedNight = { ...openNight, status: 'PAIRED' as const };
const matched: Pairing = { pairingId: 'p1', nightId: 'n1', clubId: 'c1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's1', playerName: 'Ada' }, { signupId: 's2', playerName: 'Ben' }], status: 'MATCHED' };
const odd1: Pairing = { pairingId: 'p2', nightId: 'n1', clubId: 'c1', systemKey: 'BLOOD_BOWL', players: [{ signupId: 's3', playerName: 'Cleo' }], status: 'NEEDS_RESOLUTION' };
const odd2: Pairing = { pairingId: 'p3', nightId: 'n1', clubId: 'c1', systemKey: 'WARHAMMER_40K', players: [{ signupId: 's4', playerName: 'Dot' }], status: 'NEEDS_RESOLUTION' };
```

Tests:
1. **OPEN → shows Generate, clicking it calls `generatePairings` and invalidates.** Mock `getNight`→openNight, `listPairings`→`[]`, spy `generatePairings`→`[matched]`. Render; click **Generate pairings**; assert `generatePairings` called with `('red-dice','n1')`.
2. **CLOSED → renders MATCHED pairing players + system.** Mock `getNight`→closedNight, `listPairings`→`[matched]`. Assert "Ada" and "Ben" and the 40k name appear.
3. **CLOSED with odd ones → resolve.** Mock `getNight`→closedNight, `listPairings`→`[odd1, odd2]`, spy `resolvePairing`→`{...odd1, players:[odd1.players[0], odd2.players[0]], status:'MATCHED'}`. The row for `odd1` (Cleo) has a `<select>` listing the *other* unresolved player(s) — "Dot" (value `s4`). Select it, click **Resolve**; assert `resolvePairing` called with `('red-dice','n1','p2','s4')`.
4. **CLOSED → Publish.** Mock `getNight`→closedNight, `listPairings`→`[matched]`, spy `publishPairings`→`{ night: pairedNight, pairings: [matched] }`. Click **Publish**; assert `publishPairings` called with `('red-dice','n1')`.
5. **PAIRED → read-only published view, no Publish/Generate buttons.** Mock `getNight`→pairedNight, `listPairings`→`[matched]`. Assert some "Published" indicator is present and there is no button named `/publish/i` or `/generate/i`.

(Add `userEvent`, `setToken`, type imports as needed. Reset mocks in `beforeEach` with `vi.restoreAllMocks()` then re-set `setToken`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/pages/PairingsPage.test.tsx`
Expected: FAIL — page/route don't exist.

- [ ] **Step 3: Implement `packages/frontend/src/pages/PairingsPage.tsx`**

Key points:
- Login gate identical to `OrganizerPage` (`getToken() !== null` → else render `<LoginForm onLoggedIn=… />`). Reuse the sign-out header is optional; a back link to `/c/:slug/organize` is nice-to-have.
- `useNight(slug, nightId)` for title + status; `usePairings(slug, nightId)` for the list.
- A `generate` mutation (`apiClient.generatePairings`) — `onSuccess` invalidate `['pairings',slug,nightId]` and `['night',slug,nightId]` (status changes OPEN→CLOSED).
- A `resolve` mutation taking `{ pairingId, opponentSignupId }` — `onSuccess` invalidate `['pairings',slug,nightId]`.
- A `publish` mutation (`apiClient.publishPairings`) — `onSuccess` invalidate both `['pairings',…]` and `['night',…]` (status→PAIRED).
- Derive `needsResolution = pairings.filter(p => p.status === 'NEEDS_RESOLUTION')`. For a given odd pairing, the dropdown options are the *other* `needsResolution` pairings' lone player (`p.players[0]`), value = `signupId`, label = `playerName`. Track the chosen opponent per-row in local state (`Record<pairingId, signupId>`), or a small child component per odd row holding its own `useState` for the select (cleaner — avoids one big map and per-row disable bugs).
- Render by `night.status`:
  - `OPEN`: intro text + **Generate pairings** button (disabled while pending).
  - `CLOSED`: list MATCHED rows (`playerName vs playerName · GAME_SYSTEM_NAMES[systemKey]`); list NEEDS_RESOLUTION rows each with the opponent `<select>` + **Resolve** (disabled until an opponent is chosen; if a row is the only unresolved one, show "no available opponent" and no select). A **Re-roll** (calls generate again) and a **Publish** button; if `needsResolution.length > 0` show a `role="alert"`/muted warning that unresolved players won't be emailed but publish is still allowed.
  - `PAIRED`: a "Published" badge/heading and the read-only MATCHED list; no action buttons.
- Errors: `{mutation.isError && <p role="alert">{errorMessage(mutation.error)}</p>}` for each mutation (or a shared spot).

Use accent button style for primary actions (Generate/Publish) consistent with `CreateNightForm`.

- [ ] **Step 4: Register the route in `packages/frontend/src/App.tsx`**

Add inside the `/c/:slug` parent route, after the `organize` route:

```tsx
import { PairingsPage } from './pages/PairingsPage';
// ...
<Route path="nights/:nightId/organize" element={<PairingsPage />} />
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/pages/PairingsPage.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run --workspace @club-night/frontend build`
Expected: all pass. New this slice: client 4 + PairingsPage 5 = **9**. Added to 271 → **280 total**. Typecheck clean; `vite build` produces `dist/`.

---

## Done criteria

- `npm test` passes (~280); `npm run typecheck` clean for all four packages; `vite build` produces `dist/`.
- A signed-in organizer at `/c/:slug/nights/:nightId/organize` can: generate pairings (OPEN→CLOSED), see MATCHED pairings (both players + system) and NEEDS_RESOLUTION singles, resolve an odd-one-out by merging it with another unresolved player, re-roll, and publish (CLOSED→PAIRED). A published night shows a read-only view with no action buttons.
- The dashboard's per-night **Pairings** link now resolves to this page.
- **Product complete** — backend, infra, and full frontend are done.
