# Frontend Organizer Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an organizer sign in with their Cognito email + password and reach an (initially placeholder) organizer area for a club — establishing the auth + client methods the dashboard and pairings screens build on.

**Architecture:** A thin `cognito-auth` module wraps `amazon-cognito-identity-js` (SRP sign-in → ID token), a `LoginForm` runs it and stores the ID token as the bearer (overwriting any guest token), organizer-gated client methods (`createNight`/`updateNight`/`listNightSignups`) are added to `apiClient`, and an `OrganizerPage` gates on a stored token (showing the `LoginForm` otherwise). The backend already verifies Cognito **ID** tokens (`tokenUse: 'id'`) and authorizes per-club via `requireOrganizer`.

**Tech Stack:** React 18, React Router, TanStack Query, `amazon-cognito-identity-js`, Vitest + jsdom + testing-library.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Auth — Cognito organizers; § API surface — organizer routes).
**Builds on:** slices 1–5c — 257 tests passing. Organizer endpoints (`POST/PATCH /clubs/:slug/nights`, `GET .../signups`) and the Cognito user pool + client (slice 4b, `userPassword`/`userSrp` flows) exist.

> **Commit note:** TDD with frequent commits. The owner commits; the "Commit" steps are theirs.

> **Scope:** Cognito sign-in + organizer client methods + login gate only. The night create/edit/signups dashboard is 5d-ii; pairings UI is 5d-iii. **Design:** reuse `.card`/`.container`/`--club-accent`.

> **Note on `cognito-auth`:** it's a thin adapter over `amazon-cognito-identity-js` (callback API, needs a real Cognito pool to exercise) — like the SES adapter's real path, it is NOT unit-tested; the `LoginForm` logic is tested with `signIn` mocked. Config (`VITE_COGNITO_USER_POOL_ID`/`VITE_COGNITO_CLIENT_ID`) is build-time-baked from the slice-4b stack outputs.

---

## File structure produced by this plan

```
packages/frontend/
  package.json                 (MODIFY: add amazon-cognito-identity-js)
  src/
    config.ts                  (MODIFY: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID)
    auth/cognito-auth.ts        signIn / signOut (thin adapter)
    components/LoginForm.tsx     new
    api/client.ts              (MODIFY: createNight, updateNight, listNightSignups)
    pages/OrganizerPage.tsx      new (login gate)
    App.tsx                    (MODIFY: /c/:slug/organize route)
  test/
    components/LoginForm.test.tsx     new
    api/client.test.ts         (MODIFY: organizer method tests)
    pages/OrganizerPage.test.tsx      new
```

---

## Task 1: Cognito auth module + config

**Files:**
- Modify: `packages/frontend/package.json`
- Modify: `packages/frontend/src/config.ts`
- Create: `packages/frontend/src/auth/cognito-auth.ts`

- [ ] **Step 1: Add `amazon-cognito-identity-js` to `packages/frontend/package.json` dependencies**

Add `"amazon-cognito-identity-js": "^6.3.12"` to `dependencies`. Then run `npm install`.

- [ ] **Step 2: Add Cognito config to `packages/frontend/src/config.ts`**

```ts
export const COGNITO_USER_POOL_ID: string = (import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined) ?? '';
export const COGNITO_CLIENT_ID: string = (import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined) ?? '';
```

- [ ] **Step 3: Create `packages/frontend/src/auth/cognito-auth.ts`**

```ts
import { CognitoUserPool, CognitoUser, AuthenticationDetails } from 'amazon-cognito-identity-js';
import { COGNITO_CLIENT_ID, COGNITO_USER_POOL_ID } from '../config';

function pool(): CognitoUserPool {
  return new CognitoUserPool({ UserPoolId: COGNITO_USER_POOL_ID, ClientId: COGNITO_CLIENT_ID });
}

/** Sign in with email + password (SRP); resolves the Cognito ID token. */
export function signIn(email: string, password: string): Promise<string> {
  const user = new CognitoUser({ Username: email, Pool: pool() });
  const details = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise<string>((resolve, reject) => {
    user.authenticateUser(details, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: (err) => reject(err instanceof Error ? err : new Error('Sign-in failed')),
      newPasswordRequired: () => reject(new Error('A new password is required — set it in the Cognito console first.')),
    });
  });
}

export function signOut(): void {
  pool().getCurrentUser()?.signOut();
}
```

- [ ] **Step 4: Install + typecheck**

Run: `npm install && npm run --workspace @club-night/frontend typecheck`
Expected: `amazon-cognito-identity-js` resolves; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/package.json packages/frontend/src/config.ts packages/frontend/src/auth/cognito-auth.ts package-lock.json
git commit -m "feat(frontend): add Cognito sign-in adapter"
```

---

## Task 2: `LoginForm` component

**Files:**
- Create: `packages/frontend/src/components/LoginForm.tsx`
- Test: `packages/frontend/test/components/LoginForm.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/components/LoginForm.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../setup';
import { LoginForm } from '../../src/components/LoginForm';
import * as cognitoAuth from '../../src/auth/cognito-auth';
import { getToken, setToken } from '../../src/auth/token';

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

describe('LoginForm', () => {
  it('signs in, stores the ID token, and calls onLoggedIn', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockResolvedValue('id-token-123');
    const onLoggedIn = vi.fn();
    renderWithProviders(<LoginForm onLoggedIn={onLoggedIn} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(cognitoAuth.signIn).toHaveBeenCalledWith('olivia@example.com', 'hunter2!');
    expect(getToken()).toBe('id-token-123');
  });

  it('shows an error when sign-in fails', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockRejectedValue(new Error('Incorrect username or password.'));
    renderWithProviders(<LoginForm onLoggedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/incorrect/i));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/components/LoginForm.test.tsx`
Expected: FAIL — cannot resolve `../../src/components/LoginForm`.

- [ ] **Step 3: Implement `packages/frontend/src/components/LoginForm.tsx`**

```tsx
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { signIn } from '../auth/cognito-auth';
import { setToken } from '../auth/token';

const accentButton = { background: 'var(--club-accent)', color: '#fff', border: 0, borderRadius: 8, padding: '0.6rem 1rem', cursor: 'pointer' } as const;

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => signIn(email, password),
    onSuccess: (idToken) => {
      setToken(idToken);
      onLoggedIn();
    },
  });

  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); if (!mutation.isPending) mutation.mutate(); }} style={{ display: 'grid', gap: '0.75rem' }}>
      <p className="muted">Organizer sign-in.</p>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {mutation.isError && (
        <p role="alert" className="muted">
          {mutation.error instanceof Error ? mutation.error.message : 'Sign-in failed'}
        </p>
      )}
      <button type="submit" disabled={mutation.isPending} style={accentButton}>
        {mutation.isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/components/LoginForm.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/LoginForm.tsx packages/frontend/test/components/LoginForm.test.tsx
git commit -m "feat(frontend): add organizer login form"
```

---

## Task 3: Organizer client methods

**Files:**
- Modify: `packages/frontend/src/api/client.ts`
- Modify: `packages/frontend/test/api/client.test.ts`

- [ ] **Step 1: Add failing tests to `packages/frontend/test/api/client.test.ts`**

```ts
  it('createNight POSTs and returns the night', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ night: { nightId: 'n1', title: 'Thu', status: 'OPEN' } }, 201));
    const night = await apiClient.createNight('red-dice', { title: 'Thu', eventDate: '2026-07-02T18:00:00.000Z', signupDeadline: '2026-07-02T12:00:00.000Z', offeredSystems: [{ systemKey: 'WARHAMMER_40K', prominent: true }] });
    expect(night.nightId).toBe('n1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/clubs/red-dice/nights');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('updateNight PATCHes the night', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ night: { nightId: 'n1', status: 'CANCELLED' } }));
    const night = await apiClient.updateNight('red-dice', 'n1', { status: 'CANCELLED' });
    expect(night.status).toBe('CANCELLED');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');
  });

  it('listNightSignups GETs the night signups', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ signups: [{ signupId: 's1', playerName: 'Ada' }] }));
    const signups = await apiClient.listNightSignups('red-dice', 'n1');
    expect(signups).toHaveLength(1);
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice/nights/n1/signups');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: FAIL — methods don't exist.

- [ ] **Step 3: Add the methods to `packages/frontend/src/api/client.ts`**

Add `CreateNightInput`, `UpdateNightInput`, `GameNight` to the `@club-night/shared` import (as needed), then:

```ts
  async createNight(slug: string, input: CreateNightInput): Promise<GameNight> {
    const res = await request<{ night: GameNight }>(`/clubs/${encodeURIComponent(slug)}/nights`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.night;
  },
  async updateNight(slug: string, nightId: string, input: UpdateNightInput): Promise<GameNight> {
    const res = await request<{ night: GameNight }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    );
    return res.night;
  },
  async listNightSignups(slug: string, nightId: string): Promise<Signup[]> {
    const res = await request<{ signups: Signup[] }>(
      `/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}/signups`,
    );
    return res.signups;
  },
```

- [ ] **Step 4: Run it to verify it passes + typecheck**

Run: `npx vitest run packages/frontend/test/api/client.test.ts && npm run --workspace @club-night/frontend typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/api/client.ts packages/frontend/test/api/client.test.ts
git commit -m "feat(frontend): add organizer night client methods"
```

---

## Task 4: `OrganizerPage` login gate + route

**Files:**
- Create: `packages/frontend/src/pages/OrganizerPage.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/test/pages/OrganizerPage.test.tsx`

- [ ] **Step 1: Write the failing test — `packages/frontend/test/pages/OrganizerPage.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { OrganizerPage } from '../../src/pages/OrganizerPage';
import * as cognitoAuth from '../../src/auth/cognito-auth';
import { setToken } from '../../src/auth/token';

beforeEach(() => { vi.restoreAllMocks(); setToken(null); });

function renderPage() {
  return renderWithProviders(
    <Routes>
      <Route path="/c/:slug/organize" element={<OrganizerPage />} />
    </Routes>,
    { route: '/c/red-dice/organize' },
  );
}

describe('OrganizerPage', () => {
  it('shows the login form when not signed in', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('shows the organizer area after signing in', async () => {
    vi.spyOn(cognitoAuth, 'signIn').mockResolvedValue('id-token-123');
    renderPage();
    await userEvent.type(screen.getByLabelText(/email/i), 'olivia@example.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'hunter2!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: /organize/i })).toBeInTheDocument());
  });

  it('shows the organizer area immediately when a token is already stored', () => {
    setToken('id-token-123');
    renderPage();
    expect(screen.getByRole('heading', { name: /organize/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/pages/OrganizerPage.test.tsx`
Expected: FAIL — cannot resolve `../../src/pages/OrganizerPage`.

- [ ] **Step 3: Implement `packages/frontend/src/pages/OrganizerPage.tsx`**

```tsx
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getToken, setToken } from '../auth/token';
import { signOut } from '../auth/cognito-auth';
import { LoginForm } from '../components/LoginForm';

export function OrganizerPage() {
  const { slug = '' } = useParams();
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);

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
        <h2>Organize {slug}</h2>
        <button
          type="button"
          className="muted"
          style={{ background: 'none', border: 0, cursor: 'pointer', textDecoration: 'underline' }}
          onClick={() => { signOut(); setToken(null); setLoggedIn(false); }}
        >
          Sign out
        </button>
      </header>
      <p className="muted">Night management and pairings are coming next.</p>
    </section>
  );
}
```

> The heading "Organize {slug}" matches the test's `name: /organize/i`. The dashboard contents (create/edit night, signups, pairings) land in slices 5d-ii / 5d-iii.

- [ ] **Step 4: Add the route in `packages/frontend/src/App.tsx`**

Add the import and a child route under `/c/:slug`:

```tsx
        <Route path="organize" element={<OrganizerPage />} />
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/pages/OrganizerPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run --workspace @club-night/frontend build`
Expected: all pass. New this slice: LoginForm 2 + client 3 + OrganizerPage 3 = **8**. Added to 257 → **265 total**. Typecheck clean; build produces `dist/`.

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/pages/OrganizerPage.tsx packages/frontend/src/App.tsx packages/frontend/test/pages/OrganizerPage.test.tsx
git commit -m "feat(frontend): add organizer page with login gate"
```

---

## Done criteria

- `npm test` passes (~265) and `npm run typecheck` is clean for all four packages; `vite build` produces `dist/`.
- At `/c/:slug/organize`: a signed-out visitor sees a Cognito email/password login; signing in stores the ID token and reveals the organizer area (with sign-out); an already-signed-in visitor goes straight to the organizer area.
- `apiClient` has `createNight`/`updateNight`/`listNightSignups` (organizer-gated server-side; they send the stored bearer).
- The frontend reads `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_CLIENT_ID` (from the slice-4b stack outputs) at build time.
- Remaining: slice 5d-ii (create/edit night + signups dashboard) and 5d-iii (pairings: generate → resolve → publish).
