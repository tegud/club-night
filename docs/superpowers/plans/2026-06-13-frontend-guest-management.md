# Frontend Guest Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest sign in with an emailed code and manage their signup — view it, change the game system or note, or withdraw.

**Architecture:** A small new API endpoint `GET /clubs/:slug/nights/:nightId/my-signup` resolves the guest session's email to their signup (closing the "manage by session, not by id" gap). The frontend adds client methods (`requestGuestCode`/`verifyGuestCode`/`getMySignup`/`updateSignup`/`withdrawSignup`), a `GuestCodeForm` (two-step request→verify that stores the session token), and a `ManageSignupPage` (sign-in gate → load the signup → edit system/note → withdraw).

**Tech Stack:** Hono (API), React 18 + React Router + TanStack Query, Vitest + jsdom + testing-library.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Auth — guest email-and-code; § API surface — signup management).
**Builds on:** slices 1–5b — 241 tests passing. The guest endpoints (`POST .../guest/request-code`, `.../guest/verify-code`), signup-management endpoints (`GET/PATCH/DELETE .../signups/:signupId`), `findSignupByEmail`, `requireSignupAccess`, and the frontend `apiClient`/`setToken`/`useNight` all exist.

> **Commit note:** TDD with frequent commits. The owner commits; the "Commit" steps are theirs.

> **Scope:** guest sign-in + manage-your-signup only. Organizer screens (Cognito login, night CRUD, pairings) are slice 5d. **Design:** reuse `.card`/`.container`/`--club-accent` styling.

---

## File structure produced by this plan

```
packages/api/src/routes/signup-management.ts   (MODIFY: add GET .../my-signup)
packages/api/test/routes/signup-management.test.ts (MODIFY: my-signup tests)
packages/frontend/src/
  api/client.ts                  (MODIFY: requestGuestCode, verifyGuestCode, getMySignup, updateSignup, withdrawSignup)
  club/useClub.ts                (MODIFY: useMySignup)
  components/GuestCodeForm.tsx    new
  pages/ManageSignupPage.tsx      new
  pages/NightDetailPage.tsx       (MODIFY: link to manage)
  App.tsx                         (MODIFY: manage route)
packages/frontend/test/
  api/client.test.ts             (MODIFY: new method tests)
  components/GuestCodeForm.test.tsx   new
  pages/ManageSignupPage.test.tsx     new
```

---

## Task 1: API `GET /clubs/:slug/nights/:nightId/my-signup`

**Files:**
- Modify: `packages/api/src/routes/signup-management.ts`
- Modify: `packages/api/test/routes/signup-management.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/signup-management.test.ts`**

Add (the file already seeds a club, an OPEN night `night-1`, an organizer, a signup for `ada@example.com`, and has `guestToken`, `ORGANIZER_TOKEN` helpers):

```ts
function mySignup(token?: string) {
  return createApp().request('/clubs/red-dice/nights/night-1/my-signup', {
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
}

describe('GET /clubs/:slug/nights/:nightId/my-signup', () => {
  it('returns the guest’s own signup by session email', async () => {
    const res = await mySignup(await guestToken('ada@example.com'));
    expect(res.status).toBe(200);
    expect((await res.json() as any).signup.email).toBe('ada@example.com');
  });

  it('404s when the guest has no signup on this night', async () => {
    const res = await mySignup(await guestToken('nobody@example.com'));
    expect(res.status).toBe(404);
  });

  it('401s an anonymous caller', async () => {
    expect((await mySignup()).status).toBe(401);
  });

  it('401s a guest whose session is for a different club', async () => {
    const res = await mySignup(await guestToken('ada@example.com', 'club-2'));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts`
Expected: FAIL — no `my-signup` route.

- [ ] **Step 3: Add the route to `packages/api/src/routes/signup-management.ts`**

Add `findSignupByEmail` to the `../repositories/signups` import and `UnauthorizedError` to the `../http/errors` import, then add the handler (it does NOT use `loadSignup` — it looks up by the session email, not a path signupId):

```ts
signupManagementRoutes.get('/clubs/:slug/nights/:nightId/my-signup', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const night = await requireNight(club.clubId, c.req.param('nightId'));
  const principal = c.get('principal');
  if (!principal || principal.kind !== 'guest' || principal.clubId !== club.clubId) {
    throw new UnauthorizedError('Guest sign-in required');
  }
  const signup = await findSignupByEmail(night.nightId, principal.email);
  if (!signup) throw new NotFoundError('No signup found for your email on this night');
  return c.json({ signup });
});
```

> `NotFoundError` is already imported (used by `loadSignup`). Place this route alongside the others in the file (order doesn't matter — `my-signup` doesn't collide with `signups/:signupId`).

- [ ] **Step 4: Run it to verify it passes + full suite**

Run: `npx vitest run packages/api/test/routes/signup-management.test.ts && npm test`
Expected: PASS (4 new); full suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/signup-management.ts packages/api/test/routes/signup-management.test.ts
git commit -m "feat(api): add my-signup endpoint (guest session → their signup)"
```

---

## Task 2: Frontend client methods + `useMySignup`

**Files:**
- Modify: `packages/frontend/src/api/client.ts`
- Modify: `packages/frontend/src/club/useClub.ts`
- Modify: `packages/frontend/test/api/client.test.ts`

- [ ] **Step 1: Add failing tests to `packages/frontend/test/api/client.test.ts`**

```ts
  it('requestGuestCode POSTs the email', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiClient.requestGuestCode('red-dice', 'ada@example.com');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/clubs/red-dice/guest/request-code');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: 'ada@example.com' });
  });

  it('verifyGuestCode stores the returned token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: 'guest-tok' }));
    await apiClient.verifyGuestCode('red-dice', 'ada@example.com', '123456');
    const { getToken } = await import('../../src/auth/token');
    expect(getToken()).toBe('guest-tok');
  });

  it('getMySignup GETs the my-signup endpoint', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', email: 'ada@example.com', systemKey: 'WARHAMMER_40K', status: 'CONFIRMED' } }));
    const s = await apiClient.getMySignup('red-dice', 'n1');
    expect(s.signupId).toBe('s1');
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice/nights/n1/my-signup');
  });

  it('updateSignup PATCHes and withdrawSignup DELETEs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', systemKey: 'BLOOD_BOWL', status: 'CONFIRMED' } }));
    await apiClient.updateSignup('red-dice', 'n1', 's1', { systemKey: 'BLOOD_BOWL' });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');

    fetchMock.mockResolvedValueOnce(jsonResponse({ signup: { signupId: 's1', status: 'CANCELLED' } }));
    const cancelled = await apiClient.withdrawSignup('red-dice', 'n1', 's1');
    expect(cancelled.status).toBe('CANCELLED');
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe('DELETE');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: FAIL — the new methods don't exist.

- [ ] **Step 3: Add the methods to `packages/frontend/src/api/client.ts`**

Add `setToken` to the `../auth/token` import and `UpdateSignupInput` to the `@club-night/shared` import, then add to `apiClient`:

```ts
  async requestGuestCode(slug: string, email: string): Promise<void> {
    await request<{ ok: boolean }>(`/clubs/${encodeURIComponent(slug)}/guest/request-code`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },
  async verifyGuestCode(slug: string, email: string, code: string): Promise<void> {
    const res = await request<{ token: string }>(`/clubs/${encodeURIComponent(slug)}/guest/verify-code`, {
      method: 'POST',
      body: JSON.stringify({ email, code }),
    });
    setToken(res.token);
  },
  async getMySignup(slug: string, nightId: string): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/my-signup`,
    );
    return res.signup;
  },
  async updateSignup(slug: string, nightId: string, signupId: string, input: UpdateSignupInput): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups/${encodeURIComponent(signupId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
    return res.signup;
  },
  async withdrawSignup(slug: string, nightId: string, signupId: string): Promise<Signup> {
    const res = await request<{ signup: Signup }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups/${encodeURIComponent(signupId)}`,
      { method: 'DELETE' },
    );
    return res.signup;
  },
```

- [ ] **Step 4: Add `useMySignup` to `packages/frontend/src/club/useClub.ts`**

```ts
export function useMySignup(slug: string, nightId: string, enabled: boolean) {
  return useQuery({ queryKey: ['my-signup', slug, nightId], queryFn: () => apiClient.getMySignup(slug, nightId), enabled });
}
```

- [ ] **Step 5: Run it to verify it passes + typecheck**

Run: `npx vitest run packages/frontend/test/api/client.test.ts && npm run --workspace @club-night/frontend typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/api/client.ts packages/frontend/src/club/useClub.ts packages/frontend/test/api/client.test.ts
git commit -m "feat(frontend): add guest-code + signup-management client methods"
```

---

## Task 3: `GuestCodeForm` component

**Files:**
- Create: `packages/frontend/src/components/GuestCodeForm.tsx`
- Test: `packages/frontend/test/components/GuestCodeForm.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/components/GuestCodeForm.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../setup';
import { GuestCodeForm } from '../../src/components/GuestCodeForm';
import { apiClient, ApiError } from '../../src/api/client';

beforeEach(() => vi.restoreAllMocks());

describe('GuestCodeForm', () => {
  it('requests a code then verifies it and calls onAuthed', async () => {
    vi.spyOn(apiClient, 'requestGuestCode').mockResolvedValue();
    vi.spyOn(apiClient, 'verifyGuestCode').mockResolvedValue();
    const onAuthed = vi.fn();
    renderWithProviders(<GuestCodeForm slug="red-dice" onAuthed={onAuthed} />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));

    await waitFor(() => expect(screen.getByLabelText(/code/i)).toBeInTheDocument());
    expect(apiClient.requestGuestCode).toHaveBeenCalledWith('red-dice', 'ada@example.com');

    await userEvent.type(screen.getByLabelText(/code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => expect(onAuthed).toHaveBeenCalled());
    expect(apiClient.verifyGuestCode).toHaveBeenCalledWith('red-dice', 'ada@example.com', '123456');
  });

  it('shows an error when the code is invalid', async () => {
    vi.spyOn(apiClient, 'requestGuestCode').mockResolvedValue();
    vi.spyOn(apiClient, 'verifyGuestCode').mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired code'));
    renderWithProviders(<GuestCodeForm slug="red-dice" onAuthed={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com');
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }));
    await waitFor(() => screen.getByLabelText(/code/i));
    await userEvent.type(screen.getByLabelText(/code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /verify/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/invalid or expired/i));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/components/GuestCodeForm.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/GuestCodeForm`.

- [ ] **Step 3: Implement `packages/frontend/src/components/GuestCodeForm.tsx`**

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient, ApiError } from '../api/client';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong';
}

export function GuestCodeForm({ slug, onAuthed }: { slug: string; onAuthed: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');

  const requestMutation = useMutation({
    mutationFn: () => apiClient.requestGuestCode(slug, email),
    onSuccess: () => setStep('code'),
  });
  const verifyMutation = useMutation({
    mutationFn: () => apiClient.verifyGuestCode(slug, email, code),
    onSuccess: onAuthed,
  });

  if (step === 'email') {
    return (
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (!requestMutation.isPending) requestMutation.mutate(); }} style={{ display: 'grid', gap: '0.75rem' }}>
        <p className="muted">Enter your email and we’ll send you a sign-in code.</p>
        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        {requestMutation.isError && <p role="alert" className="muted">{errorMessage(requestMutation.error)}</p>}
        <button type="submit" disabled={requestMutation.isPending} style={accentButton}>
          {requestMutation.isPending ? 'Sending…' : 'Email me a code'}
        </button>
      </form>
    );
  }

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (!verifyMutation.isPending) verifyMutation.mutate(); }} style={{ display: 'grid', gap: '0.75rem' }}>
      <p className="muted">We sent a code to {email}.</p>
      <label>Code<input value={code} onChange={(e) => setCode(e.target.value)} required /></label>
      {verifyMutation.isError && <p role="alert" className="muted">{errorMessage(verifyMutation.error)}</p>}
      <button type="submit" disabled={verifyMutation.isPending} style={accentButton}>
        {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/components/GuestCodeForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/GuestCodeForm.tsx packages/frontend/test/components/GuestCodeForm.test.tsx
git commit -m "feat(frontend): add guest sign-in code form"
```

---

## Task 4: `ManageSignupPage` (gate → view → edit → withdraw) + route + link

**Files:**
- Create: `packages/frontend/src/pages/ManageSignupPage.tsx`
- Modify: `packages/frontend/src/pages/NightDetailPage.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/test/pages/ManageSignupPage.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/pages/ManageSignupPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import type { GameNight, Signup } from '@club-night/shared';
import { renderWithProviders } from '../setup';
import { ManageSignupPage } from '../../src/pages/ManageSignupPage';
import { apiClient } from '../../src/api/client';
import { setToken } from '../../src/auth/token';

const night: GameNight = {
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN', eventType: 'SCHEDULED_GAME_NIGHT',
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM',
  offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }, { systemKey: 'BLOOD_BOWL', prominent: false }], createdBy: 'u1',
};
const signup: Signup = { signupId: 's1', nightId: 'n1', clubId: 'c1', playerName: 'Ada', email: 'ada@example.com', systemKey: 'WARHAMMER_40K', status: 'CONFIRMED' };

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/c/:slug/nights/:nightId/manage" element={<ManageSignupPage />} />
    </Routes>,
    { route: '/c/red-dice/nights/n1/manage' },
  );
}

describe('ManageSignupPage', () => {
  it('shows the sign-in form when there is no token', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /email me a code/i })).toBeInTheDocument();
  });

  it('shows the signup and lets the guest withdraw when authed', async () => {
    setToken('guest-tok');
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night);
    vi.spyOn(apiClient, 'getMySignup').mockResolvedValue(signup);
    const withdraw = vi.spyOn(apiClient, 'withdrawSignup').mockResolvedValue({ ...signup, status: 'CANCELLED' });
    renderPage();
    await waitFor(() => expect(screen.getByText(/your signup/i)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /withdraw/i }));
    await waitFor(() => expect(screen.getByText(/withdrawn/i)).toBeInTheDocument());
    expect(withdraw).toHaveBeenCalledWith('red-dice', 'n1', 's1');
  });

  it('shows a not-found message when the guest has no signup', async () => {
    setToken('guest-tok');
    vi.spyOn(apiClient, 'getNight').mockResolvedValue(night);
    const { ApiError } = await import('../../src/api/client');
    vi.spyOn(apiClient, 'getMySignup').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'No signup found'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/no signup found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/pages/ManageSignupPage.test.tsx`
Expected: FAIL — cannot resolve `../../src/pages/ManageSignupPage`.

- [ ] **Step 3: Implement `packages/frontend/src/pages/ManageSignupPage.tsx`**

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GAME_SYSTEM_NAMES, type GameSystemKey } from '@club-night/shared';
import { useMySignup, useNight } from '../club/useClub';
import { apiClient, ApiError } from '../api/client';
import { getToken } from '../auth/token';
import { GuestCodeForm } from '../components/GuestCodeForm';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.5rem 0.9rem', cursor: 'pointer' } as const;

export function ManageSignupPage() {
  const { slug = '', nightId = '' } = useParams();
  const [authed, setAuthed] = useState(() => getToken() !== null);
  const queryClient = useQueryClient();

  const nightQ = useNight(slug, nightId);
  const signupQ = useMySignup(slug, nightId, authed);

  const [systemKey, setSystemKey] = useState<GameSystemKey | ''>('');
  const [note, setNote] = useState('');
  const [initialised, setInitialised] = useState(false);
  if (signupQ.data && !initialised) {
    setSystemKey(signupQ.data.systemKey);
    setNote(signupQ.data.note ?? '');
    setInitialised(true);
  }

  const updateMutation = useMutation({
    mutationFn: () => apiClient.updateSignup(slug, nightId, signupQ.data!.signupId, { systemKey: systemKey as GameSystemKey, note: note || undefined }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-signup', slug, nightId] }),
  });
  const withdrawMutation = useMutation({
    mutationFn: () => apiClient.withdrawSignup(slug, nightId, signupQ.data!.signupId),
  });

  if (!authed) {
    return (
      <section>
        <h2>Manage your signup</h2>
        <GuestCodeForm slug={slug} onAuthed={() => setAuthed(true)} />
      </section>
    );
  }

  if (withdrawMutation.isSuccess) {
    return <section><h2>Manage your signup</h2><p className="muted">Your signup has been withdrawn.</p></section>;
  }

  if (signupQ.isLoading || nightQ.isLoading) return <p>Loading…</p>;
  if (signupQ.isError && signupQ.error instanceof ApiError && signupQ.error.status === 404) {
    return <section><h2>Manage your signup</h2><p className="muted">No signup found for your email on this night.</p></section>;
  }
  if (!signupQ.data || !nightQ.data) return <p className="muted">Could not load your signup.</p>;

  return (
    <section>
      <h2>Your signup</h2>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (!updateMutation.isPending) updateMutation.mutate(); }} style={{ display: 'grid', gap: '0.75rem' }}>
        <label>Game system
          <select value={systemKey} onChange={(e) => setSystemKey(e.target.value as GameSystemKey)}>
            {nightQ.data.offeredSystems.map((s) => (
              <option key={s.systemKey} value={s.systemKey}>{GAME_SYSTEM_NAMES[s.systemKey]}</option>
            ))}
          </select>
        </label>
        <label>Note<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {updateMutation.isError && <p role="alert" className="muted">{updateMutation.error instanceof ApiError ? updateMutation.error.message : 'Something went wrong'}</p>}
        {updateMutation.isSuccess && <p role="status" className="muted">Saved.</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="submit" disabled={updateMutation.isPending} style={accentButton}>Save changes</button>
          <button type="button" onClick={() => { if (!withdrawMutation.isPending) withdrawMutation.mutate(); }} disabled={withdrawMutation.isPending} style={{ ...accentButton, background: '#b91c1c' }}>Withdraw</button>
        </div>
      </form>
    </section>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/pages/ManageSignupPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the route + a link from `NightDetailPage`**

In `packages/frontend/src/App.tsx`, add a child route under `/c/:slug`:

```tsx
        <Route path="nights/:nightId/manage" element={<ManageSignupPage />} />
```
(import `ManageSignupPage` at the top.)

In `packages/frontend/src/pages/NightDetailPage.tsx`, add a "Manage your signup" link (use react-router `Link`) below the form/closed message, e.g. inside the `<section>`:

```tsx
import { Link } from 'react-router-dom';
// ...near the bottom of the returned section:
      <p className="muted" style={{ marginTop: '1rem' }}>
        Already signed up? <Link to={`/c/${slug}/nights/${nightId}/manage`}>Manage your signup</Link>
      </p>
```

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run --workspace @club-night/frontend build`
Expected: all pass. New this slice: api my-signup 4 + client 4 + GuestCodeForm 2 + ManageSignupPage 3 = **13**. Added to 241 → **254 total**. Typecheck clean; build produces `dist/`.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/ManageSignupPage.tsx packages/frontend/src/pages/NightDetailPage.tsx packages/frontend/src/App.tsx packages/frontend/test/pages/ManageSignupPage.test.tsx
git commit -m "feat(frontend): add manage-your-signup page (sign in, edit, withdraw)"
```

---

## Done criteria

- `npm test` passes (~254) and `npm run typecheck` is clean for all four packages; `vite build` produces `dist/`.
- `GET /clubs/:slug/nights/:nightId/my-signup` returns the guest session's signup (404 if none, 401 if not a matching-club guest).
- At `/c/:slug/nights/:nightId/manage`: a guest signs in with an emailed code, then sees their signup and can change the game system / note (save) or withdraw it; a guest with no signup sees a clear message.
- `NightDetailPage` links to the manage page.
- Remaining: slice 5d (organizer screens — Cognito login, create/edit night, view signups, generate/resolve/publish pairings).
