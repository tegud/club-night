# Frontend Organizer Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in organizer a working dashboard for a club: create a game night (title, date/time, signup deadline, offered systems) and see the club's nights with a cancel action and a per-night pairings link.

**Architecture:** A `CreateNightForm` (controlled inputs; `datetime-local` → ISO; offered-systems checkboxes sourced from the club's `enabledSystems`) calls `apiClient.createNight` and invalidates the nights query; the `OrganizerPage` authed branch loads the club (for `enabledSystems`) + nights (`useClub`/`useNights`), renders the form + a nights list with a cancel button (`updateNight → CANCELLED`) and a Pairings link. A 403 on create surfaces a clear "not an organizer" message (the single-token model means a guest token reaches here).

**Tech Stack:** React 18, React Router, TanStack Query, Vitest + jsdom + testing-library.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Frontend; organizer night management).
**Builds on:** slice 5d-i (Cognito auth, `OrganizerPage` login gate, `createNight`/`updateNight`/`listNightSignups` client methods) — 266 tests passing.

> **Commit note:** TDD with frequent commits. The owner commits; the "Commit" steps are theirs.

> **Scope:** create-night + nights list + cancel only. The per-night pairings UI (generate/resolve/publish) is slice 5d-iii — this slice just links to `/c/:slug/nights/:nightId/organize`. **Design:** reuse `.card`/`.container`/`--club-accent`.

> **Date handling:** `datetime-local` inputs hold a timezone-naive local string; convert with `new Date(value).toISOString()` (UTC `…Z`, which `createNightSchema`'s `z.string().datetime()` accepts). Tests assert the *shape* (title, offeredSystems) and that dates are ISO strings, NOT exact values (timezone-dependent).

> **Test note:** the dashboard's authed branch now calls `getClub`/`listNights`, so the slice-5d-i `OrganizerPage` logged-in tests must mock those (otherwise they hit a real fetch). This plan updates `OrganizerPage.test.tsx` accordingly.

---

## File structure produced by this plan

```
packages/frontend/src/
  components/CreateNightForm.tsx   new
  pages/OrganizerPage.tsx          (MODIFY: authed branch → dashboard)
packages/frontend/test/
  components/CreateNightForm.test.tsx   new
  pages/OrganizerPage.test.tsx     (MODIFY: mock club/nights; add dashboard tests)
```

---

## Task 1: `CreateNightForm` component

**Files:**
- Create: `packages/frontend/src/components/CreateNightForm.tsx`
- Test: `packages/frontend/test/components/CreateNightForm.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/components/CreateNightForm.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameSystemKey } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { CreateNightForm } from '../../src/components/CreateNightForm';
import { apiClient, ApiError } from '../../src/api/client';

const enabledSystems: GameSystemKey[] = ['WARHAMMER_40K', 'BLOOD_BOWL'];

beforeEach(() => vi.restoreAllMocks());

function fill() {
  fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'Thursday Night' } });
  fireEvent.change(screen.getByLabelText(/date & time/i), { target: { value: '2026-07-02T18:00' } });
  fireEvent.change(screen.getByLabelText(/signups close/i), { target: { value: '2026-07-02T12:00' } });
}

describe('CreateNightForm', () => {
  it('creates a night with the chosen systems', async () => {
    const spy = vi.spyOn(apiClient, 'createNight').mockResolvedValue({ nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT', pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [{ systemKey: 'BLOOD_BOWL', prominent: false }], createdBy: 'u1' });
    renderWithProviders(<CreateNightForm slug="red-dice" enabledSystems={enabledSystems} />);
    fill();
    await userEvent.click(screen.getByLabelText(/blood bowl/i));
    await userEvent.click(screen.getByRole('button', { name: /create night/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/created/i));
    expect(spy).toHaveBeenCalledWith('red-dice', expect.objectContaining({
      title: 'Thursday Night',
      offeredSystems: [{ systemKey: 'BLOOD_BOWL', prominent: false }],
    }));
    const arg = spy.mock.calls[0]![1];
    expect(arg.eventDate).toMatch(/Z$/);
    expect(arg.signupDeadline).toMatch(/Z$/);
  });

  it('requires at least one system (button disabled until one is picked)', async () => {
    vi.spyOn(apiClient, 'createNight');
    renderWithProviders(<CreateNightForm slug="red-dice" enabledSystems={enabledSystems} />);
    fill();
    expect(screen.getByRole('button', { name: /create night/i })).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/warhammer/i));
    expect(screen.getByRole('button', { name: /create night/i })).toBeEnabled();
  });

  it('shows a not-an-organizer message on 403', async () => {
    vi.spyOn(apiClient, 'createNight').mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'You are not an organizer of this club'));
    renderWithProviders(<CreateNightForm slug="red-dice" enabledSystems={enabledSystems} />);
    fill();
    await userEvent.click(screen.getByLabelText(/warhammer/i));
    await userEvent.click(screen.getByRole('button', { name: /create night/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not an organizer/i));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/components/CreateNightForm.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/CreateNightForm`.

- [ ] **Step 3: Implement `packages/frontend/src/components/CreateNightForm.tsx`**

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GAME_SYSTEM_NAMES, type GameSystemKey } from '@club-night/shared';
import { apiClient, ApiError } from '../api/client';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

function createError(error: unknown): string {
  if (error instanceof ApiError && error.status === 403) return "You're not an organizer of this club.";
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong';
}

export function CreateNightForm({ slug, enabledSystems }: { slug: string; enabledSystems: GameSystemKey[] }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [signupDeadline, setSignupDeadline] = useState('');
  const [selected, setSelected] = useState<GameSystemKey[]>([]);

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createNight(slug, {
        title,
        eventDate: new Date(eventDate).toISOString(),
        signupDeadline: new Date(signupDeadline).toISOString(),
        offeredSystems: selected.map((systemKey) => ({ systemKey, prominent: false })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nights', slug] });
      setTitle('');
      setEventDate('');
      setSignupDeadline('');
      setSelected([]);
    },
  });

  const toggle = (key: GameSystemKey) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const canSubmit = !mutation.isPending && selected.length > 0;

  return (
    <form
      className="card"
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <h3>Create a game night</h3>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label>Date &amp; time<input type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required /></label>
      <label>Signups close<input type="datetime-local" value={signupDeadline} onChange={(e) => setSignupDeadline(e.target.value)} required /></label>
      <fieldset style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
        <legend>Game systems</legend>
        {enabledSystems.map((key) => (
          <label key={key} style={{ display: 'block' }}>
            <input type="checkbox" checked={selected.includes(key)} onChange={() => toggle(key)} /> {GAME_SYSTEM_NAMES[key]}
          </label>
        ))}
      </fieldset>
      {selected.length === 0 && <p className="muted">Pick at least one game system.</p>}
      {mutation.isError && <p role="alert" className="muted">{createError(mutation.error)}</p>}
      {mutation.isSuccess && <p role="status" className="muted">Night created.</p>}
      <button type="submit" disabled={!canSubmit} style={accentButton}>
        {mutation.isPending ? 'Creating…' : 'Create night'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/components/CreateNightForm.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/CreateNightForm.tsx packages/frontend/test/components/CreateNightForm.test.tsx
git commit -m "feat(frontend): add create-night form"
```

---

## Task 2: `OrganizerPage` dashboard (form + nights list + cancel)

**Files:**
- Modify: `packages/frontend/src/pages/OrganizerPage.tsx`
- Modify: `packages/frontend/test/pages/OrganizerPage.test.tsx`

- [ ] **Step 1: Update `packages/frontend/test/pages/OrganizerPage.test.tsx`**

The dashboard now calls `getClub`/`listNights` — mock them in the logged-in tests. Add imports and mocks; update the existing logged-in tests and add dashboard tests:

```tsx
import { apiClient } from '../../src/api/client';
import type { Club, GameNight } from '@club-night/shared';

const club: Club = { clubId: 'c1', slug: 'red-dice', name: 'Red Dice Club', logoUrl: 'l', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K', 'BLOOD_BOWL'] };
const night: GameNight = { nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT', pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }], createdBy: 'u1' };

// In the two existing "logged in" tests (sign-in transition + token-already-stored), add before rendering:
//   vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
//   vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
```

Add new dashboard tests:

```tsx
describe('OrganizerPage dashboard', () => {
  beforeEach(() => {
    setToken('id-token-123');
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
  });

  it('renders the create-night form and the nights list', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole('heading', { name: /create a game night/i })).toBeInTheDocument());
    expect(screen.getByText('Thursday Night')).toBeInTheDocument();
  });

  it('cancels a night', async () => {
    const cancel = vi.spyOn(apiClient, 'updateNight').mockResolvedValue({ ...night, status: 'CANCELLED' });
    renderPage();
    await waitFor(() => expect(screen.getByText('Thursday Night')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('red-dice', 'n1', { status: 'CANCELLED' }));
  });
});
```

(Add `userEvent` import if not present.)

- [ ] **Step 2: Run it to verify the new tests fail**

Run: `npx vitest run packages/frontend/test/pages/OrganizerPage.test.tsx`
Expected: FAIL — no create form / nights list / cancel button yet.

- [ ] **Step 3: Fill in the dashboard in `packages/frontend/src/pages/OrganizerPage.tsx`**

Replace the authed-branch placeholder with the dashboard. Add imports (`useMutation`, `useQueryClient`, `Link`, `useClub`, `useNights`, `apiClient`, `CreateNightForm`) and render:

```tsx
import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getToken, setToken } from '../auth/token';
import { signOut } from '../auth/cognito-auth';
import { useClub, useNights } from '../club/useClub';
import { apiClient } from '../api/client';
import { LoginForm } from '../components/LoginForm';
import { CreateNightForm } from '../components/CreateNightForm';

export function OrganizerPage() {
  const { slug = '' } = useParams();
  // TODO(5d-ii): getToken() is also non-null for a stored GUEST token; a guest token will 403
  // on organizer calls — the create-night form surfaces that clearly ("not an organizer").
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);
  const queryClient = useQueryClient();

  const clubQ = useClub(slug);
  const nightsQ = useNights(slug);
  const cancelMutation = useMutation({
    mutationFn: (nightId: string) => apiClient.updateNight(slug, nightId, { status: 'CANCELLED' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nights', slug] }),
  });

  if (!loggedIn) {
    return (
      <section>
        <h2>Organizer sign-in</h2>
        <LoginForm onLoggedIn={() => setLoggedIn(true)} />
      </section>
    );
  }

  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Organize {clubQ.data?.name ?? slug}</h2>
        <button
          type="button"
          className="muted"
          style={{ background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => { try { signOut(); } finally { setToken(null); setLoggedIn(false); } }}
        >
          Sign out
        </button>
      </header>

      {clubQ.data && <CreateNightForm slug={slug} enabledSystems={clubQ.data.enabledSystems} />}

      <h3 style={{ marginTop: '1.5rem' }}>Nights</h3>
      {nightsQ.isLoading && <p>Loading nights…</p>}
      {nightsQ.data && nightsQ.data.length === 0 && <p className="muted">No upcoming nights yet.</p>}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.5rem' }}>
        {nightsQ.data?.map((night) => (
          <li key={night.nightId} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
            <span>
              <strong>{night.title}</strong> <span className="muted">· {night.status}</span>
            </span>
            <span style={{ display: 'flex', gap: '0.75rem' }}>
              <Link to={`/c/${slug}/nights/${night.nightId}/organize`}>Pairings</Link>
              <button type="button" onClick={() => cancelMutation.mutate(night.nightId)} disabled={cancelMutation.isPending} style={{ background: 'none', border: 0, color: '#b91c1c', cursor: 'pointer' }}>Cancel</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

> The header heading is now "Organize {club name}" — the existing logged-in tests assert `/organize/i`, which still matches.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/pages/OrganizerPage.test.tsx`
Expected: PASS (3 prior + 2 dashboard = 5 tests).

- [ ] **Step 5: Run the full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run --workspace @club-night/frontend build`
Expected: all pass. New this slice: CreateNightForm 3 + OrganizerPage dashboard 2 = **5**. Added to 266 → **271 total**. Typecheck clean; build produces `dist/`.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/pages/OrganizerPage.tsx packages/frontend/test/pages/OrganizerPage.test.tsx
git commit -m "feat(frontend): organizer dashboard with create-night and nights list"
```

---

## Done criteria

- `npm test` passes (~271) and `npm run typecheck` is clean for all four packages; `vite build` produces `dist/`.
- A signed-in organizer at `/c/:slug/organize` sees a create-night form (title, date/time, deadline, system checkboxes from the club's enabled systems) and the club's nights with a Cancel action and a per-night Pairings link; a 403 on create shows a clear "not an organizer" message.
- Creating a night invalidates the nights list (it appears); cancelling sets the night to `CANCELLED`.
- Remaining: slice 5d-iii (per-night pairings: generate → resolve odd-ones-out → publish) — the last piece.
