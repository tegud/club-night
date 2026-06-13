# Frontend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the static React frontend — CORS-enabled API, a Vite/React/TS app with a typed API client, client-side routing under `/c/:slug`, per-club theming (logo + primary colour), and a club-home page listing upcoming nights.

**Architecture:** A new `packages/frontend` (Vite + React 18 + TS, pure static build). Data fetching via TanStack Query against a typed `apiClient` that shares `@club-night/shared` types and attaches a bearer token when present. React Router renders everything inside a club shell that loads branding by slug and applies the club's primary colour as a CSS custom property. Component tests run under Vitest + jsdom with the API client mocked. The API gets a Hono CORS middleware so the separate-origin static site can call it.

**Tech Stack:** Vite, React 18, TypeScript, React Router 6, TanStack Query 5, Vitest + jsdom + @testing-library/react, Hono CORS (API side).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Frontend; path-based tenancy; branding).
**Builds on:** slices 1–4b — 219 tests passing. API endpoints (`GET /clubs/:slug`, `GET /clubs/:slug/nights`, `GET /clubs/:slug/nights/:nightId`) exist; the API is deployed behind a Function URL (slice 4b).

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Scope:** foundation + club-home only. Signup/guest screens are 5b; organizer screens (incl. Cognito login) are 5c. **Design direction:** clean, modern, accessible; generous spacing, system font stack, one accent colour driven entirely by the club's `primaryColour` (CSS var `--club-accent`); no heavy UI framework.

> **Vitest note:** the root `vitest.config.ts` globs `packages/*/test/**`; frontend component tests are `.test.tsx` and need jsdom. This plan updates the root `include` to match `.tsx` and each frontend test declares `// @vitest-environment jsdom` + imports `@testing-library/jest-dom/vitest`. The existing dynalite global-setup still runs once (harmless for frontend tests).

---

## File structure produced by this plan

```
packages/api/src/app.ts            (MODIFY: add Hono CORS middleware)
packages/api/test/routes/cors.test.ts
vitest.config.ts                   (MODIFY: include *.test.tsx)
packages/frontend/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx                       React root + providers (router, query)
    App.tsx                        route table
    config.ts                      API base URL from import.meta.env
    api/client.ts                  typed apiClient (getClub, listNights, getNight)
    api/types.ts                   response DTOs (re-using @club-night/shared)
    auth/token.ts                  get/set bearer token (localStorage)
    club/ClubShell.tsx             loads branding by slug, applies theme, renders <Outlet/>
    club/useClub.ts                react-query hook
    pages/ClubHomePage.tsx         upcoming nights list
    styles.css                     base + theme variables
  test/
    setup.tsx                      renderWithProviders helper
    api/client.test.ts
    club/ClubShell.test.tsx
    pages/ClubHomePage.test.tsx
```

---

## Task 1: Enable CORS on the API

**Files:**
- Modify: `packages/api/src/app.ts`
- Test: `packages/api/test/routes/cors.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/routes/cors.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { createApp } from '../../src/app';

beforeEach(async () => {
  await resetTable();
});

describe('CORS', () => {
  it('answers a preflight OPTIONS with permissive CORS headers', async () => {
    const res = await createApp().request('/clubs/red-dice', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://app.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  });

  it('adds the allow-origin header to a normal response', async () => {
    const res = await createApp().request('/clubs/missing', { headers: { origin: 'https://app.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/cors.test.ts`
Expected: FAIL — no CORS headers.

- [ ] **Step 3: Add CORS to `packages/api/src/app.ts`**

Add the import and register it FIRST (before `authMiddleware`, so preflight short-circuits before auth). Bearer tokens (not cookies) are used, so `origin: '*'` is safe:

```ts
import { cors } from 'hono/cors';
```

Inside `createApp`, immediately after `app.notFound(...)` and before `app.use('*', authMiddleware)`:

```ts
  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    }),
  );
```

- [ ] **Step 4: Run it to verify it passes + full suite**

Run: `npx vitest run packages/api/test/routes/cors.test.ts && npm test`
Expected: PASS (2 new tests); the full suite still green (existing route tests unaffected — CORS headers are additive).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/app.ts packages/api/test/routes/cors.test.ts
git commit -m "feat(api): enable permissive CORS for the static frontend"
```

---

## Task 2: Frontend scaffold + Vitest/jsdom wiring

**Files:**
- Create: `packages/frontend/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/config.ts`, `src/styles.css`, `src/pages/ClubHomePage.tsx` (placeholder)
- Create: `packages/frontend/test/setup.tsx`, `packages/frontend/test/app.test.tsx`
- Modify: `vitest.config.ts` (root)

- [ ] **Step 1: Create `packages/frontend/package.json`**

```json
{
  "name": "@club-night/frontend",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@club-night/shared": "*",
    "@tanstack/react-query": "^5.51.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.0",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.1",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `packages/frontend/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/frontend/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 4: Create `packages/frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Club Night</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `packages/frontend/src/config.ts`**

```ts
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';
```

- [ ] **Step 6: Create `packages/frontend/src/styles.css`**

```css
:root {
  --club-accent: #444444;
  --bg: #fafafa;
  --fg: #1a1a1a;
  --muted: #6b7280;
  --card: #ffffff;
  --border: #e5e7eb;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
}
a { color: var(--club-accent); }
.container { max-width: 720px; margin: 0 auto; padding: 1.5rem; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 1rem 1.25rem; }
.accent-bar { height: 4px; background: var(--club-accent); }
.muted { color: var(--muted); }
```

- [ ] **Step 7: Create the placeholder page — `packages/frontend/src/pages/ClubHomePage.tsx`**

```tsx
export function ClubHomePage() {
  return <p>Club home</p>;
}
```

- [ ] **Step 8: Create `packages/frontend/src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { ClubHomePage } from './pages/ClubHomePage';

export function App() {
  return (
    <Routes>
      <Route path="/c/:slug" element={<ClubHomePage />} />
      <Route path="*" element={<p>Not found</p>} />
    </Routes>
  );
}
```

- [ ] **Step 9: Create `packages/frontend/src/main.tsx`**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 10: Create the test render helper — `packages/frontend/test/setup.tsx`**

```tsx
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: { route?: string } & RenderOptions = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
    options,
  );
}
```

- [ ] **Step 11: Update the root `vitest.config.ts` include glob to match `.tsx`**

Change the `include` line to:

```ts
    include: ['packages/*/test/**/*.test.{ts,tsx}'],
```

(Leave the rest — globalSetup, env, fileParallelism — unchanged; it's harmless for jsdom frontend tests.)

- [ ] **Step 12: Write the smoke test — `packages/frontend/test/app.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from './setup';
import { ClubHomePage } from '../src/pages/ClubHomePage';

describe('App routing', () => {
  it('renders the club home placeholder at /c/:slug', () => {
    renderWithProviders(
      <Routes>
        <Route path="/c/:slug" element={<ClubHomePage />} />
      </Routes>,
      { route: '/c/red-dice' },
    );
    expect(screen.getByText('Club home')).toBeInTheDocument();
  });
});
```

- [ ] **Step 13: Install + run**

Run: `npm install && npx vitest run packages/frontend && npm run --workspace @club-night/frontend typecheck`
Expected: deps resolve; PASS (1 test); typecheck clean. Also run `npm test` to confirm the whole suite (api + shared + infra + frontend) is green.

- [ ] **Step 14: Commit**

```bash
git add packages/frontend vitest.config.ts package-lock.json
git commit -m "chore(frontend): scaffold Vite + React app with vitest/jsdom"
```

---

## Task 3: Typed API client

**Files:**
- Create: `packages/frontend/src/api/types.ts`
- Create: `packages/frontend/src/auth/token.ts`
- Create: `packages/frontend/src/api/client.ts`
- Test: `packages/frontend/test/api/client.test.ts`

- [ ] **Step 1: Create response DTO types — `packages/frontend/src/api/types.ts`**

```ts
import type { Club, GameNight } from '@club-night/shared';

export type ClubBranding = Club; // GET /clubs/:slug returns the Club fields
export interface NightsResponse {
  nights: GameNight[];
}
export interface NightResponse {
  night: GameNight;
}
export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
```

- [ ] **Step 2: Create the bearer-token store — `packages/frontend/src/auth/token.ts`**

```ts
const KEY = 'club-night.token';

export function getToken(): string | null {
  return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
}
export function setToken(token: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}
```

- [ ] **Step 3: Write the failing client test — `packages/frontend/test/api/client.test.ts`**

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiClient, ApiError } from '../../src/api/client';
import { setToken } from '../../src/auth/token';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  setToken(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('apiClient', () => {
  it('GETs a club by slug', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ clubId: 'c1', slug: 'red-dice', name: 'Red Dice', logoUrl: 'l', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K'] }));
    const club = await apiClient.getClub('red-dice');
    expect(club.name).toBe('Red Dice');
    expect(fetchMock.mock.calls[0]![0]).toContain('/clubs/red-dice');
  });

  it('lists nights', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ nights: [] }));
    expect(await apiClient.listNights('red-dice')).toEqual([]);
  });

  it('attaches the bearer token when present', async () => {
    setToken('tok-123');
    fetchMock.mockResolvedValueOnce(jsonResponse({ nights: [] }));
    await apiClient.listNights('red-dice');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });

  it('throws ApiError with the error code on a non-2xx response', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 'NOT_FOUND', message: 'Club not found' } }, 404));
    await expect(apiClient.getClub('missing')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: FAIL — cannot resolve `../../src/api/client`.

- [ ] **Step 5: Implement `packages/frontend/src/api/client.ts`**

```ts
import { API_BASE_URL } from '../config';
import { getToken } from '../auth/token';
import type { ClubBranding, NightResponse, NightsResponse, ApiErrorBody } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  const body = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = (body as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? res.statusText);
  }
  return body as T;
}

export const apiClient = {
  getClub(slug: string): Promise<ClubBranding> {
    return request<ClubBranding>(`/clubs/${encodeURIComponent(slug)}`);
  },
  async listNights(slug: string) {
    const res = await request<NightsResponse>(`/clubs/${encodeURIComponent(slug)}/nights`);
    return res.nights;
  },
  async getNight(slug: string, nightId: string) {
    const res = await request<NightResponse>(`/clubs/${encodeURIComponent(slug)}/nights/${encodeURIComponent(nightId)}`);
    return res.night;
  },
};
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/api/client.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/frontend/src/api packages/frontend/src/auth packages/frontend/test/api
git commit -m "feat(frontend): add typed API client with bearer auth"
```

---

## Task 4: Club shell (theming) + club-home page

**Files:**
- Create: `packages/frontend/src/club/useClub.ts`
- Create: `packages/frontend/src/club/ClubShell.tsx`
- Modify: `packages/frontend/src/pages/ClubHomePage.tsx`
- Modify: `packages/frontend/src/App.tsx`
- Test: `packages/frontend/test/club/ClubShell.test.tsx`, `packages/frontend/test/pages/ClubHomePage.test.tsx`

- [ ] **Step 1: Create the club query hook — `packages/frontend/src/club/useClub.ts`**

```ts
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';

export function useClub(slug: string) {
  return useQuery({ queryKey: ['club', slug], queryFn: () => apiClient.getClub(slug) });
}

export function useNights(slug: string) {
  return useQuery({ queryKey: ['nights', slug], queryFn: () => apiClient.listNights(slug) });
}
```

- [ ] **Step 2: Write the failing ClubShell test — `packages/frontend/test/club/ClubShell.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { ClubShell } from '../../src/club/ClubShell';
import { apiClient } from '../../src/api/client';

beforeEach(() => vi.restoreAllMocks());

const club = { clubId: 'c1', slug: 'red-dice', name: 'Red Dice Club', logoUrl: 'https://x/logo.png', primaryColour: '#B22222', enabledSystems: ['WARHAMMER_40K' as const] };

describe('ClubShell', () => {
  it('renders the club name + logo and applies the accent colour', async () => {
    vi.spyOn(apiClient, 'getClub').mockResolvedValue(club);
    renderWithProviders(
      <Routes>
        <Route path="/c/:slug" element={<ClubShell />}>
          <Route index element={<p>inner</p>} />
        </Route>
      </Routes>,
      { route: '/c/red-dice' },
    );
    await waitFor(() => expect(screen.getByText('Red Dice Club')).toBeInTheDocument());
    expect(screen.getByRole('img', { name: /red dice club/i })).toHaveAttribute('src', 'https://x/logo.png');
    expect(document.documentElement.style.getPropertyValue('--club-accent')).toBe('#B22222');
    expect(screen.getByText('inner')).toBeInTheDocument();
  });

  it('shows a not-found message when the club does not exist', async () => {
    const { ApiError } = await import('../../src/api/client');
    vi.spyOn(apiClient, 'getClub').mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Club not found'));
    renderWithProviders(
      <Routes>
        <Route path="/c/:slug" element={<ClubShell />} />
      </Routes>,
      { route: '/c/missing' },
    );
    await waitFor(() => expect(screen.getByText(/club not found/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/club/ClubShell.test.tsx`
Expected: FAIL — cannot resolve `../../src/club/ClubShell`.

- [ ] **Step 4: Implement `packages/frontend/src/club/ClubShell.tsx`**

```tsx
import { useEffect } from 'react';
import { useParams, Outlet } from 'react-router-dom';
import { useClub } from './useClub';

export function ClubShell() {
  const { slug = '' } = useParams();
  const { data: club, isLoading, isError } = useClub(slug);

  useEffect(() => {
    if (club) document.documentElement.style.setProperty('--club-accent', club.primaryColour);
  }, [club]);

  if (isLoading) return <div className="container">Loading…</div>;
  if (isError || !club) return <div className="container">Club not found</div>;

  return (
    <>
      <div className="accent-bar" />
      <div className="container">
        <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
          <img src={club.logoUrl} alt={club.name} style={{ height: 48, width: 48, objectFit: 'contain' }} />
          <h1 style={{ margin: 0, fontSize: '1.4rem' }}>{club.name}</h1>
        </header>
        <Outlet context={{ slug }} />
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/frontend/test/club/ClubShell.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the failing ClubHomePage test — `packages/frontend/test/pages/ClubHomePage.test.tsx`**

```tsx
// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders } from '../setup';
import { ClubHomePage } from '../../src/pages/ClubHomePage';
import { apiClient } from '../../src/api/client';

const night = {
  nightId: 'n1', clubId: 'c1', title: 'Thursday Night', eventDate: '2026-07-02T18:00:00.000Z',
  signupDeadline: '2026-07-02T12:00:00.000Z', status: 'OPEN' as const, eventType: 'SCHEDULED_GAME_NIGHT' as const,
  pairingStrategy: 'RANDOM_WITHIN_SYSTEM' as const, offeredSystems: [{ systemKey: 'WARHAMMER_40K' as const, prominent: true }], createdBy: 'u1',
};

beforeEach(() => vi.restoreAllMocks());

function renderHome() {
  return renderWithProviders(
    <Routes>
      <Route path="/c/:slug" element={<ClubHomePage />} />
    </Routes>,
    { route: '/c/red-dice' },
  );
}

describe('ClubHomePage', () => {
  it('lists upcoming nights', async () => {
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([night]);
    renderHome();
    await waitFor(() => expect(screen.getByText('Thursday Night')).toBeInTheDocument());
  });

  it('shows an empty state when there are no nights', async () => {
    vi.spyOn(apiClient, 'listNights').mockResolvedValue([]);
    renderHome();
    await waitFor(() => expect(screen.getByText(/no upcoming game nights/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run packages/frontend/test/pages/ClubHomePage.test.tsx`
Expected: FAIL — `ClubHomePage` still renders the placeholder.

- [ ] **Step 8: Implement `packages/frontend/src/pages/ClubHomePage.tsx`**

```tsx
import { useParams, Link } from 'react-router-dom';
import { useNights } from '../club/useClub';

export function ClubHomePage() {
  const { slug = '' } = useParams();
  const { data: nights, isLoading } = useNights(slug);

  if (isLoading) return <p>Loading nights…</p>;
  if (!nights || nights.length === 0) return <p className="muted">No upcoming game nights yet.</p>;

  return (
    <section>
      <h2>Upcoming game nights</h2>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: '0.75rem' }}>
        {nights.map((night) => (
          <li key={night.nightId} className="card">
            <Link to={`/c/${slug}/nights/${night.nightId}`} style={{ fontWeight: 600 }}>
              {night.title}
            </Link>
            <div className="muted">{new Date(night.eventDate).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 9: Wire the routes in `packages/frontend/src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom';
import { ClubShell } from './club/ClubShell';
import { ClubHomePage } from './pages/ClubHomePage';

export function App() {
  return (
    <Routes>
      <Route path="/c/:slug" element={<ClubShell />}>
        <Route index element={<ClubHomePage />} />
      </Route>
      <Route path="*" element={<div className="container">Page not found</div>} />
    </Routes>
  );
}
```

> Note: `ClubHomePage` reads `:slug` via `useParams`, which resolves from the parent `/c/:slug` route — so it works both as the index child here and when tested standalone with a `/c/:slug` route.

- [ ] **Step 10: Run the frontend tests + typecheck + full suite**

Run: `npx vitest run packages/frontend && npm run --workspace @club-night/frontend typecheck && npm test`
Expected: frontend tests PASS (app 1 + client 4 + ClubShell 2 + ClubHomePage 2 = 9); typecheck clean; full suite green.

- [ ] **Step 11: Verify the production build works**

Run: `npm run --workspace @club-night/frontend build`
Expected: Vite produces a static `dist/` with no errors (confirms the app compiles + bundles for static hosting).

- [ ] **Step 12: Commit**

```bash
git add packages/frontend/src packages/frontend/test
git commit -m "feat(frontend): club shell theming and club-home night list"
```

---

## Done criteria

- `npm test` passes (~230 tests: 219 prior + 2 CORS + 9 frontend) and `npm run typecheck` is clean for all four packages.
- `npm run --workspace @club-night/frontend build` produces a static `dist/`.
- The API answers CORS preflight + sets `Access-Control-Allow-Origin` so the separate-origin static site can call it.
- Visiting `/c/:slug` loads the club's branding (logo + name), applies its `primaryColour` as the accent, and lists upcoming nights (with an empty state); an unknown club shows "Club not found".
- The frontend reads its API base from `VITE_API_URL` (the slice-4b `ApiUrl` output).
- Remaining: slice 5b (signup + guest-code management screens) and 5c (organizer screens incl. Cognito login).
