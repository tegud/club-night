# Frontend Signup Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a visitor open a game night and sign up — a night-detail page that shows the night and a signup form (name, email, game system, optional note) that posts to the API and confirms.

**Architecture:** Extend the typed `apiClient` with `createSignup`, add a `useNight` query hook, a `NightDetailPage` route under the club shell, and a `SignupForm` (controlled inputs + a TanStack Query mutation). Signups are gated on `night.status === 'OPEN'` (mirrors the API). Component tests use jsdom + testing-library + user-event with the API client mocked.

**Tech Stack:** React 18, React Router 6, TanStack Query 5, Vitest + jsdom + @testing-library/react + user-event.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Frontend; guest signup).
**Builds on:** slice 5a (frontend foundation — `apiClient`, `ClubShell`, routing, theming) — 233 tests passing. API endpoint `POST /clubs/:slug/nights/:nightId/signups` (validated by `signupInputSchema`, requires the night `OPEN`) exists.

> **Commit note:** TDD with frequent commits. The repo owner commits themselves; the "Commit" steps are theirs to run.

> **Scope:** night detail + signup creation only. Guest-code request/verify + manage-your-signup (edit/withdraw) are slice 5c; organizer screens are slice 5d. **Design:** reuse the existing `.card`/`.container`/`--club-accent` styling; the signup button uses the club accent.

---

## File structure produced by this plan

```
packages/frontend/src/
  api/client.ts                  (MODIFY: add createSignup)
  club/useClub.ts                (MODIFY: add useNight)
  components/SignupForm.tsx       new
  pages/NightDetailPage.tsx       new
  App.tsx                         (MODIFY: add nights/:nightId child route)
packages/frontend/test/
  api/client.test.ts              (MODIFY: createSignup tests)
  components/SignupForm.test.tsx   new
  pages/NightDetailPage.test.tsx   new
```

---

## Task 1: `apiClient.createSignup` + `useNight` hook

**Files:**
- Modify: `packages/frontend/src/api/client.ts`
- Modify: `packages/frontend/src/club/useClub.ts`
- Modify: `packages/frontend/test/api/client.test.ts`

- [ ] **Step 1: Add failing tests to `packages/frontend/test/api/client.test.ts`**

```ts
  it('POSTs a signup and returns the created signup', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', playerName: 'Ada', systemKey: 'WARHAMMER_40K', status: 'CONFIRMED' } }, 201));
    const signup = await apiClient.createSignup('red-dice', 'n1', { playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K' });
    expect(signup.signupId).toBe('s1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/clubs/red-dice/nights/n1/signups');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ playerName: 'Ada', systemKey: 'WARHAMMER_40K' });
  });

  it('surfaces a 409 (night not open) as an ApiError', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'CONFLICT', message: 'This game night is not open for signups' } }, 409));
    await expect(
      apiClient.createSignup('red-dice', 'n1', { playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: FAIL — `createSignup` is not a function.

- [ ] **Step 3: Add `createSignup` to `packages/frontend/src/api/client.ts`**

Add `Signup`, `SignupInput` to the `@club-night/shared` import (or import from there), then add the method to the `apiClient` object:

```ts
import type { Signup, SignupInput } from '@club-night/shared';
```

```ts
  async createSignup(slug: string, nightId: string, input: SignupInput): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups`,
      { method: 'POST', body: JSON.stringify(input) },
    );
    return res.signup;
  },
```

- [ ] **Step 4: Add `useNight` to `packages/frontend/src/club/useClub.ts`**

```ts
export function useNight(slug: string, nightId: string) {
  return useQuery({ queryKey: ['night', slug, nightId], queryFn: () => apiClient.getNight(slug, nightId) });
}
```

- [ ] **Step 5: Run it to verify it passes + typecheck**

Run: `npx vitest run packages/frontend/test/api/client.test.ts && npm run --workspace @club-night/frontend typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/api/client.ts packages/frontend/src/club/useClub.ts packages/frontend/test/api/client.test.ts
git commit -m "feat(frontend): add createSignup client method and useNight hook"
```

---

## Task 2: `SignupForm` component

**Files:**
- Create: `packages/frontend/src/components/SignupForm.tsx`
- Test: `packages/frontend/test/components/SignupForm.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/components/SignupForm.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameNight } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { SignupForm } from '../../src/components/SignupForm';
import { apiClient, ApiError } from '../../src/api/client';

const night: GameNight = {
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
  offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }, { systemKey: 'BLOOD_BOWL', prominent: false }],
  createdBy: 'u1',
};

beforeEach(() => vi.restoreAllMocks());

describe('SignupForm', () => {
  it('submits a signup and shows confirmation', async () => {
    const spy = vi.spyOn(apiClient, 'createSignup').mockResolvedValue({ signupId: 's1', nightId: 'n1', clubId: 'c1', playerName: 'Ada', email: 'ada@example.com', systemKey: 'BLOOD_BOWL', status: 'CONFIRMED' });
    renderWithProviders(<SignupForm slug="red-dice" night={night} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.selectOptions(screen.getByLabelText(/game system/i), 'BLOOD_BOWL');
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/signed up/i));
    expect(spy).toHaveBeenCalledWith('red-dice', 'n1', expect.objectContaining({ playerName: 'Ada', email: 'ada@example.com', systemKey: 'BLOOD_BOWL' }));
  });

  it('shows the error message when the night is not open', async () => {
    vi.spyOn(apiClient, 'createSignup').mockRejectedValue(new ApiError(409, 'CONFLICT', 'This game night is not open for signups'));
    renderWithProviders(<SignupForm slug="red-dice" night={night} />);
    await userEvent.type(screen.getByLabelText(/name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /sign up/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not open/i));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/components/SignupForm.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/SignupForm`.

- [ ] **Step 3: Implement `packages/frontend/src/components/SignupForm.tsx`**

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { GAME_SYSTEM_NAMES, type GameNight, type GameSystemKey } from '@club-night/shared';
import { apiClient, ApiError } from '../api/client';

export function SignupForm({ slug, night }: { slug: string; night: GameNight }) {
  const [playerName, setPlayerName] = useState('');
  const [email, setEmail] = useState('');
  const [systemKey, setSystemKey] = useState<GameSystemKey>(night.offeredSystems[0]!.systemKey);
  const [note, setNote] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.createSignup(slug, night.nightId, { playerName, email, systemKey, ...(note ? { note } : {}) }),
  });

  if (mutation.isSuccess) {
    return (
      <div className="card" role="status">
        <strong>You're signed up!</strong>
        <p className="muted">Playing {GAME_SYSTEM_NAMES[mutation.data.systemKey]} at {night.title}.</p>
      </div>
    );
  }

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      style={{ display: 'grid', gap: '0.75rem' }}
    >
      <label>
        Name
        <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} required />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Game system
        <select value={systemKey} onChange={(e) => setSystemKey(e.target.value as GameSystemKey)}>
          {night.offeredSystems.map((s) => (
            <option key={s.systemKey} value={s.systemKey}>
              {GAME_SYSTEM_NAMES[s.systemKey]}
              {s.prominent ? ' ★' : ''}
            </option>
          ))}
        </select>
      </label>
      <label>
        Note (optional)
        <textarea value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {mutation.isError && (
        <p role="alert" className="muted">
          {mutation.error instanceof ApiError ? mutation.error.message : 'Something went wrong'}
        </p>
      )}
      <button type="submit" disabled={mutation.isPending} style={{ background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' }}>
        {mutation.isPending ? 'Signing up…' : 'Sign up'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/components/SignupForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/SignupForm.tsx packages/frontend/test/components/SignupForm.test.tsx
git commit -m "feat(frontend): add signup form"
```

---

## Task 3: `NightDetailPage` + route

**Files:**
- Create: `packages/frontend/src/pages/NightDetailPage.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/test/pages/NightDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/pages/NightDetailPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import type { GameNight } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { NightDetailPage } from '../../src/pages/NightDetailPage';
import { apiClient, ApiError } from '../../src/api/client';

const night = (over: Partial<GameNight> = {}): GameNight => ({
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM', offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }], createdBy: 'u1', ...over,
});

beforeEach(() => vi.restoreAllMocks());

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/c/:slug/nights/:nightId" element={<NightDetailPage />} />
    </Routes>,
    { route: '/c/red-dice/nights/n1' },
  );
}

describe('NightDetailPage', () => {
  it('shows the night and a signup form when OPEN', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night());
    renderPage();
    await waitFor(() => expect(screen.getByText('Thursday Night')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /sign up/i })).toBeInTheDocument();
  });

  it('shows a closed message when the night is not OPEN', async () => {
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night({ status: 'PAIRED' }));
    renderPage();
    await waitFor(() => expect(screen.getByText(/signups .* closed/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /sign up/i })).not.toBeInTheDocument();
  });

  it('shows not-found when the night does not exist', async () => {
    vi.spyOn(apiClient, 'getNight').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Game night not found'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/game night not found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/pages/NightDetailPage.test.tsx`
Expected: FAIL — cannot resolve `../../src/pages/NightDetailPage`.

- [ ] **Step 3: Implement `packages/frontend/src/pages/NightDetailPage.tsx`**

```tsx
import { useParams } from 'react-router-dom';
import { useNight } from '../club/useClub';
import { SignupForm } from '../components/SignupForm';

export function NightDetailPage() {
  const { slug = '', nightId = '' } = useParams();
  const { data: night, isLoading, isError } = useNight(slug, nightId);

  if (isLoading) return <p>Loading night…</p>;
  if (isError || !night) return <p className="muted">Game night not found.</p>;

  return (
    <section>
      <h2>{night.title}</h2>
      <p className="muted">
        {new Date(night.eventDate).toLocaleString()} · signups close {new Date(night.signupDeadline).toLocaleString()}
      </p>
      {night.status === 'OPEN' ? (
        <SignupForm slug={slug} night={night} />
      ) : (
        <p className="muted">Signups for this night are closed.</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Add the route in `packages/frontend/src/App.tsx`**

Add the import and a child route under the `/c/:slug` `ClubShell` route:

```tsx
import { Routes, Route } from 'react-router-dom';
import { ClubShell } from './club/ClubShell';
import { ClubHomePage } from './pages/ClubHomePage';
import { NightDetailPage } from './pages/NightDetailPage';

export function App() {
  return (
    <Routes>
      <Route path="/c/:slug" element={<ClubShell />}>
        <Route index element={<ClubHomePage />} />
        <Route path="nights/:nightId" element={<NightDetailPage />} />
      </Route>
      <Route path="*" element={<div className="container">Page not found</div>} />
    </Routes>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/pages/NightDetailPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run --workspace @club-night/frontend build`
Expected: all pass. New this slice: client 2 + SignupForm 2 + NightDetailPage 3 = **7**. Added to 233 → **240 total**. Typecheck clean; build produces `dist/`.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/NightDetailPage.tsx packages/frontend/src/App.tsx packages/frontend/test/pages/NightDetailPage.test.tsx
git commit -m "feat(frontend): add night detail page with signup"
```

---

## Done criteria

- `npm test` passes (~240) and `npm run typecheck` is clean for all four packages; `vite build` produces `dist/`.
- From the club home, clicking a night opens `/c/:slug/nights/:nightId` showing the night's date/deadline and (when `OPEN`) a signup form; submitting it posts to the API and confirms; a non-OPEN night shows a closed message; an unknown night shows not-found.
- The signup form selects from the night's offered systems (prominent ones marked), and surfaces API errors (e.g. 409 not-open, 400 validation) inline.
- Remaining: slice 5c (guest email-code request/verify + manage-your-signup edit/withdraw) and slice 5d (organizer screens incl. Cognito login).
