# Club Night — Design Spec

**Date:** 2026-06-11
**Status:** Approved for planning

## Overview

Club Night is a multi-tenant web application for wargaming clubs to run **scheduled
game nights**: players sign up for a game system, and the system randomly pairs them
with an opponent who chose the same system. Each club has its own branding. The first
build deliberately targets only scheduled game nights with random pairing, but the data
model is designed so that one-off events, campaigns, and leagues can be added later
without migration.

### Tech stack (fixed by requirements)

- **Frontend:** Vite + React, built as a pure static export (deployable to S3, Netlify,
  or any static host — no AWS coupling). Talks to the API via a configured base URL.
- **API:** A single AWS Lambda running a lightweight [Hono](https://hono.dev) router,
  exposed via a Lambda Function URL (or API Gateway HTTP API).
- **Database:** Amazon DynamoDB, single-table design.
- **Auth:** Amazon Cognito (organizers + opt-in players) plus a lightweight
  email-and-code guest flow.
- **Email:** Amazon SES.
- **Scheduling:** Amazon EventBridge Scheduler (one-shot triggers for auto-pairing).
- **Infrastructure as code:** AWS CDK (TypeScript).

## Goals & success criteria

- A club organizer can log in, create a game night offering several game systems, and
  set a signup deadline.
- A casual player can sign up with just their name + email and manage that signup using
  a code emailed to them — no account required.
- A regular player can optionally use a Cognito account and see their history across
  nights.
- At the deadline, the system automatically pairs players at random within each game
  system, emails the pairings, and flags any odd-one-out to the organizer.
- Each club's space is reached at `/c/<slug>` and renders that club's logo and colour.

## Scope

### In scope (the first build)

- **Game night management (organizer, Cognito):** create a night with date, signup
  deadline, and the set of game systems offered. Each offered system can be marked as a
  default / prominent option (so a player who only plays one system has a fast path).
- **Guest signup:** name + email + system choice + optional note to the organizer.
  Managed afterwards via an emailed single-use code.
- **Logged-in player signup (Cognito):** same signup, tied to an account, with opt-in
  cross-night history.
- **Auto-pairing at the deadline:** EventBridge Scheduler fires at the cutoff; the
  pairing engine pairs players randomly within each system. Paired players are emailed.
- **Odd-one-out handling:** a leftover player in a system is flagged to the organizer to
  resolve manually (the app does not auto-create trios or byes).
- **Email notifications (SES):** signup confirmation + management code; guest code
  requests; pairing published; odd-player resolution.
- **Path-based multi-tenancy:** `/c/<slug>`; every record and API call is scoped to a
  `clubId`. Branding (logo + primary colour) is loaded per club.
- **Single-table DynamoDB**, **AWS CDK** infrastructure, **static React** frontend.

### Out of scope (designed-for, not built now)

These are intentionally deferred (YAGNI). The data model accommodates them, but no code
or UI is built for them in the MVP:

- **Club registration / club-admin UI or API.** Clubs, their branding, the first
  organizer account, and organizer membership are provisioned **manually** via the
  runbook in the [Club provisioning](#club-provisioning-runbook) section below.
- Leagues, campaigns, and standings.
- "Request a specific opponent" (a reserved field exists; no UI/logic).
- Points / format-based pairing.
- Capacity caps and waitlists.
- Subdomain-based tenancy.
- Automatic 3-player groups for odd numbers.
- Repeat-pairing avoidance across nights.
- Payments.

## Repository structure

An npm-workspaces monorepo:

```
club-night/
  packages/
    shared/      Shared TypeScript types, zod schemas, game-system catalogue
    api/         Hono app on one Lambda: route handlers, data-access, pairing engine
    frontend/    Vite + React, pure static build
    infra/       AWS CDK app: Lambda + Function URL, DynamoDB, Cognito, SES, EventBridge
  package.json   Workspace root
  tsconfig.base.json
```

Rationale for **one Lambda with internal Hono routing** (rather than a function per
route): far simpler to develop, test, and reason about; cold starts are negligible at
club scale; a single deployable artifact.

## Domain model

The core entity is a generic **Event** so future scenarios slot in without migration:

- An **Event** carries `eventType` (MVP value: `SCHEDULED_GAME_NIGHT`) and
  `pairingStrategy` (MVP value: `RANDOM_WITHIN_SYSTEM`). Campaigns/leagues will add round
  and standings entities against the same Signup/Pairing skeleton.
- **Game systems** are reference data: `WARHAMMER_40K`, `AGE_OF_SIGMAR`, `BLOOD_BOWL`,
  `HORUS_HERESY`. Adding a system is configuration, not code. A club records which
  systems it has enabled; a night offers a subset of those.
- A **Signup**'s identity is *either* a Cognito `userId` *or* a guest `email` — the same
  record shape either way.
- A reserved `requestedOpponentSignupId` field exists on Signup so "play a specific
  person" can be added later with no migration. It is unused in the MVP.

### Game night lifecycle (status)

`DRAFT` → `OPEN` (accepting signups) → `CLOSED` (deadline passed, pairing in progress) →
`PAIRED` (pairings published) → `COMPLETED`. `CANCELLED` is reachable from any pre-paired
state.

## DynamoDB single-table design

One table with `PK` / `SK` and three GSIs. Every item carries a `clubId` attribute for
tenant scoping. IDs use ULIDs (time-sortable) except where a natural key is better.

| Item        | PK                       | SK                              | Key attributes / index notes |
|-------------|--------------------------|---------------------------------|------------------------------|
| Club        | `CLUB#<clubId>`          | `#META`                         | `slug`, `name`, `logoUrl`, `primaryColour`, `enabledSystems`. **GSI1**: `GSI1PK=CLUBSLUG#<slug>` → slug lookup |
| Membership  | `CLUB#<clubId>`          | `MEMBER#<userId>`               | `role` (OWNER/ORGANIZER/PLAYER), `displayName`, `email`. **GSI2**: `GSI2PK=USER#<userId>` → a user's clubs |
| Game night  | `CLUB#<clubId>`          | `NIGHT#<nightId>`               | `title`, `eventDate`, `signupDeadline`, `status`, `eventType`, `pairingStrategy`, `offeredSystems` (each `{ systemKey, prominent }`), `createdBy`. nightId = ULID → range-query a club's nights by time |
| Signup      | `NIGHT#<nightId>`        | `SIGNUP#<signupId>`             | `clubId`, `playerName`, `email`, `userId?`, `systemKey`, `note?`, `status`, `requestedOpponentSignupId?` (reserved). **GSI3**: `GSI3PK=NIGHT#<nightId>#EMAIL#<emailLower>` → a guest's signups for a night. **GSI2**: `GSI2PK=USER#<userId>`, `GSI2SK=SIGNUP#<nightId>` → logged-in player history (the `SIGNUP#` vs `CLUB#` SK prefix separates a user's signups from their memberships in the same partition) |
| Pairing     | `NIGHT#<nightId>`        | `PAIRING#<systemKey>#<pairingId>` | `clubId`, `systemKey`, `players` (1 or 2 `{ signupId, playerName }`), `status` (`PUBLISHED` / `NEEDS_RESOLUTION`). An odd-one-out is a pairing with a single player and `status=NEEDS_RESOLUTION` |
| Auth code   | `AUTHCODE#<codeHash>`    | `#META`                         | `email`, `clubId`, `purpose`, `createdAt`, `ttl` (DynamoDB TTL). Single-use |

### GSI summary

- **GSI1** — `CLUBSLUG#<slug>` → resolve a club by its URL slug.
- **GSI2** — `USER#<userId>` → a user's club memberships and signup history.
- **GSI3** — `NIGHT#<nightId>#EMAIL#<emailLower>` → a guest's signups for a night.

### Primary access patterns

- Resolve club + branding by slug (GSI1).
- List a club's upcoming nights, sorted by time (`PK=CLUB#<clubId>`, SK `begins_with NIGHT#`).
- Get a night's detail and its offered systems (single get).
- List all signups for a night — the pairing query (`PK=NIGHT#<nightId>`, SK `begins_with SIGNUP#`).
- Find a guest's signups for a night by email (GSI3).
- List a logged-in player's signups across nights (GSI2).
- List a night's pairings, grouped by system (`PK=NIGHT#<nightId>`, SK `begins_with PAIRING#`).

## Authentication & authorization

- API middleware resolves a **principal** on every request from one of:
  - a **Cognito JWT** (organizer or opt-in player), verified against the user pool's JWKS;
  - a **guest-session JWT** issued by our API (see below).
- **Guest email-and-code flow:**
  1. Guest enters their email for a club.
  2. API generates a 6-digit code, stores its hash with a short TTL (e.g. 15 min) and
     `clubId` in the auth-code item, and emails the plaintext code via SES.
  3. Guest submits the code; API verifies the hash, marks it used (single-use), and
     issues a **guest-session JWT** scoped to that `email` + `clubId`, valid for ~30 days.
  4. The guest session can view/edit only signups matching its email within that club.
- **Authorization** always checks `clubId` scope plus role. Organizer-only routes
  (creating/editing nights, viewing all signups, generating/resolving pairings) require
  an `OWNER` or `ORGANIZER` membership of that club.

## API surface (representative)

Public / branding:
- `GET /clubs/:slug` — branding + enabled systems.
- `GET /clubs/:slug/nights` — upcoming nights.
- `GET /nights/:nightId` — night detail + offered systems.

Guest auth:
- `POST /clubs/:slug/guest/request-code` — `{ email }`.
- `POST /clubs/:slug/guest/verify-code` — `{ email, code }` → guest-session JWT.

Signups (guest session or Cognito principal):
- `POST /nights/:nightId/signups` — `{ playerName, email, systemKey, note? }`.
- `GET  /signups/:signupId`
- `PATCH /signups/:signupId` — change system / note.
- `DELETE /signups/:signupId` — withdraw.

Organizer (Cognito + OWNER/ORGANIZER membership):
- `POST /clubs/:clubId/nights` — create a night.
- `PATCH /nights/:nightId` — edit / cancel.
- `GET  /nights/:nightId/signups` — all signups.
- `GET  /nights/:nightId/pairings` — current pairings + unresolved.
- `POST /nights/:nightId/pairings/generate` — manual (re-)roll override.
- `PATCH /pairings/:pairingId` — manually pair / resolve an odd-one-out.
- `POST /nights/:nightId/pairings/publish` — publish + notify (idempotent).

Internal:
- The EventBridge Scheduler target invokes the pairing routine for a night at its
  deadline (direct Lambda invoke or an authenticated internal route).

## Pairing engine

Implemented as a **pure function** for testability:

```
pairNight(signupsGroupedBySystem) -> { pairings: Pairing[], unpaired: Signup[] }
```

- For each game system: Fisher–Yates shuffle the confirmed signups, then pair
  sequentially. If the count is odd, the final unpaired signup goes into `unpaired`.
- `RANDOM_WITHIN_SYSTEM` is the only MVP strategy. The signature accommodates future
  strategies (specific-opponent pre-matching, points-based) without changing callers.

**Trigger flow:** when a night is created/opened, a one-shot EventBridge schedule is set
for its `signupDeadline`. At that time the pairing Lambda:
1. Loads all confirmed signups for the night, groups by system, runs `pairNight`.
2. Persists pairings; odd-one-out players are stored as `NEEDS_RESOLUTION` pairings.
3. Emails paired players their opponent + system + night details.
4. Notifies the organizer of any players needing resolution.

The organizer may **re-roll** (regenerate) or **manually pair/resolve** before or after.
Publishing is **idempotent**: a status guard prevents re-emailing already-published
players.

## Error handling & edge cases

- All request bodies validated with shared **zod** schemas; failures return structured
  `4xx` responses.
- Signing up on a `CLOSED`/past-deadline or `CANCELLED` night is rejected.
- **One signup per email per night** — a repeat from the same email edits the existing
  signup rather than creating a duplicate.
- **Email is non-blocking:** a signup still succeeds if SES fails; sends are retried and
  failures logged (a failed confirmation email does not roll back the signup).
- Pairing generation and publish are guarded against double-notification.

## Testing strategy

- **Unit (TDD):** the pairing engine (pure function — primary TDD target), zod schemas,
  and principal/authorization resolution.
- **Integration:** API handlers against **DynamoDB Local**, with SES mocked.
- **Frontend:** component tests for the signup flow and per-club theming (logo + colour
  applied from branding).

## Extensibility notes

- **One-off events:** a single-occurrence `Event` with no pairing or simple pairing —
  already supported by the Event model.
- **Campaigns / leagues:** add round and standings entities linked to a parent event;
  the Signup/Pairing skeleton is reused.
- **Game systems:** add to the reference catalogue and to a club's `enabledSystems`.
- **Specific-opponent requests:** populate the reserved `requestedOpponentSignupId` and
  add a pre-matching pass to the pairing engine.

## Club provisioning runbook

In the MVP there is **no UI or API to create a club**. A club record, its branding, its
first organizer account, and that organizer's membership are created manually by an
operator with AWS access. Steps:

1. **Choose a slug** — URL-safe, unique (e.g. `red-dice-club`). This is the club's path:
   `/c/red-dice-club`. Confirm no existing club uses it (query GSI1 on
   `CLUBSLUG#<slug>`).
2. **Generate a `clubId`** — a ULID.
3. **Prepare branding** — upload the club's logo to the public assets location (e.g. the
   frontend's static asset bucket / CDN) and note its URL. Pick the primary colour as a
   hex string (e.g. `#B22222`).
4. **Create the Club item** in the DynamoDB table:
   ```
   PK            = CLUB#<clubId>
   SK            = #META
   clubId        = <clubId>
   slug          = <slug>
   name          = <display name>
   logoUrl       = <uploaded logo URL>
   primaryColour = <hex>
   enabledSystems = ["WARHAMMER_40K","AGE_OF_SIGMAR","BLOOD_BOWL","HORUS_HERESY"]
   GSI1PK        = CLUBSLUG#<slug>
   GSI1SK        = CLUB#<clubId>
   ```
   Example AWS CLI:
   ```bash
   aws dynamodb put-item --table-name <TABLE> --item '{
     "PK": {"S":"CLUB#<clubId>"},
     "SK": {"S":"#META"},
     "clubId": {"S":"<clubId>"},
     "slug": {"S":"<slug>"},
     "name": {"S":"<display name>"},
     "logoUrl": {"S":"<logo url>"},
     "primaryColour": {"S":"#B22222"},
     "enabledSystems": {"SS":["WARHAMMER_40K","AGE_OF_SIGMAR","BLOOD_BOWL","HORUS_HERESY"]},
     "GSI1PK": {"S":"CLUBSLUG#<slug>"},
     "GSI1SK": {"S":"CLUB#<clubId>"}
   }'
   ```
5. **Create the organizer's Cognito user** in the user pool (console or
   `aws cognito-idp admin-create-user`). Note the user's `sub` — this is the `userId`.
6. **Create the Membership item** linking the organizer to the club as `OWNER`:
   ```
   PK         = CLUB#<clubId>
   SK         = MEMBER#<userId>
   clubId     = <clubId>
   userId     = <userId>
   role       = OWNER
   displayName = <organizer name>
   email      = <organizer email>
   GSI2PK     = USER#<userId>
   GSI2SK     = CLUB#<clubId>
   ```
7. **Verify** — log in as the organizer and open `/c/<slug>`; confirm the branding
   renders and the organizer can create a game night.
