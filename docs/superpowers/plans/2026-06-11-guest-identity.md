# Guest Identity (Email-and-Code) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a casual player prove ownership of an email address for a club without an account: request a one-time code (emailed), then exchange it for a short-lived guest-session token.

**Architecture:** A pluggable `EmailSender` (real SES adapter + in-memory test fake behind a settable provider), a TTL'd auth-code record in the single table keyed by club+email, pure code generation/hashing, a guest-session JWT (HS256 via `jose`), a small service that ties code → email and verify → token, and two public endpoints. No authorization or principal middleware here — those land in slice 3b alongside the protected endpoints that consume them.

**Tech Stack:** TypeScript, Hono, `@aws-sdk/client-ses`, `jose`, Node `crypto`, zod, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Authentication & authorization — guest email-and-code flow).
**Builds on:** slices 1 + 2 (shared package, db layer, repositories, Hono app — 62 tests passing).

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Scope refinement vs the original "slice 3":** this plan is guest identity ONLY. Cognito verification, the memberships repository, the principal-resolution middleware, and authorization helpers move to slice 3b, where the protected endpoints consume them — keeping every unit here exercised by the guest flow.

---

## File structure produced by this plan

```
packages/api/
  package.json                       (MODIFY: add @aws-sdk/client-ses, jose)
  src/
    email/
      sender.ts                      EmailMessage + EmailSender interface
      ses-sender.ts                  SesEmailSender (real SES adapter, injectable client)
      provider.ts                    getEmailSender() / setEmailSender() (overridable singleton)
    db/keys.ts                       (MODIFY: add authCodePk, authCodeSk)
    repositories/
      auth-codes.ts                  putAuthCode, getAuthCode, deleteAuthCode
    auth/
      code.ts                        generateNumericCode, hashGuestCode (pure)
      guest-session.ts               issueGuestSession, verifyGuestSession (jose HS256)
      guest-code-service.ts          requestGuestCode, verifyGuestCode
    http/errors.ts                   (MODIFY: add UnauthorizedError)
    routes/guest.ts                  request-code + verify-code endpoints
    app.ts                           (MODIFY: mount guestRoutes)
  test/
    fakes/email.ts                   FakeEmailSender (collects sent messages)
    email/ses-sender.test.ts
    repositories/auth-codes.test.ts
    auth/code.test.ts
    auth/guest-session.test.ts
    auth/guest-code-service.test.ts
    routes/guest.test.ts
vitest.config.ts                     (MODIFY: add GUEST_JWT_SECRET to test env)
```

---

## Task 1: EmailSender abstraction (SES adapter + test fake)

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/src/email/sender.ts`
- Create: `packages/api/src/email/ses-sender.ts`
- Create: `packages/api/src/email/provider.ts`
- Create: `packages/api/test/fakes/email.ts`
- Test: `packages/api/test/email/ses-sender.test.ts`

- [ ] **Step 1: Add dependencies to `packages/api/package.json`**

Add `@aws-sdk/client-ses` and `jose` to `dependencies` (jose is used in Task 4; add both now). The dependencies block becomes:

```json
  "dependencies": {
    "@aws-sdk/client-dynamodb": "^3.637.0",
    "@aws-sdk/client-ses": "^3.637.0",
    "@aws-sdk/lib-dynamodb": "^3.637.0",
    "@club-night/shared": "*",
    "hono": "^4.5.8",
    "jose": "^5.6.3",
    "ulid": "^2.3.0",
    "zod": "^3.23.8"
  },
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes; `@aws-sdk/client-ses` and `jose` resolve under `node_modules/`.

- [ ] **Step 3: Create `packages/api/src/email/sender.ts`**

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
```

- [ ] **Step 4: Write the failing SES adapter test — `packages/api/test/email/ses-sender.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { SesEmailSender } from '../../src/email/ses-sender';

describe('SesEmailSender', () => {
  it('sends a SendEmailCommand with the right source, destination, subject and body', async () => {
    const captured: { input: unknown }[] = [];
    const stubClient = {
      send: async (command: { input: unknown }) => {
        captured.push(command);
        return {};
      },
    };

    // The stub stands in for a SESClient; only `.send` is used.
    const sender = new SesEmailSender(stubClient as never, 'from@club.test');
    await sender.send({ to: 'player@example.com', subject: 'Your code', text: 'Code: 123456' });

    expect(captured).toHaveLength(1);
    const input = captured[0]!.input as {
      Source: string;
      Destination: { ToAddresses: string[] };
      Message: { Subject: { Data: string }; Body: { Text: { Data: string } } };
    };
    expect(input.Source).toBe('from@club.test');
    expect(input.Destination.ToAddresses).toEqual(['player@example.com']);
    expect(input.Message.Subject.Data).toBe('Your code');
    expect(input.Message.Body.Text.Data).toBe('Code: 123456');
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `npx vitest run packages/api/test/email/ses-sender.test.ts`
Expected: FAIL — cannot resolve `../../src/email/ses-sender`.

- [ ] **Step 6: Implement `packages/api/src/email/ses-sender.ts`**

```ts
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import type { EmailMessage, EmailSender } from './sender';

export class SesEmailSender implements EmailSender {
  constructor(
    private readonly client: SESClient = new SESClient({}),
    private readonly from: string = process.env.EMAIL_FROM ?? 'no-reply@club-night.app',
  ) {}

  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [message.to] },
        Message: {
          Subject: { Data: message.subject },
          Body: { Text: { Data: message.text } },
        },
      }),
    );
  }
}
```

- [ ] **Step 7: Run it to verify it passes**

Run: `npx vitest run packages/api/test/email/ses-sender.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Create the overridable provider — `packages/api/src/email/provider.ts`**

```ts
import type { EmailSender } from './sender';
import { SesEmailSender } from './ses-sender';

let sender: EmailSender | undefined;

export function getEmailSender(): EmailSender {
  if (!sender) sender = new SesEmailSender();
  return sender;
}

/** Override the email sender (used by tests). Pass undefined to reset to the default. */
export function setEmailSender(next: EmailSender | undefined): void {
  sender = next;
}
```

- [ ] **Step 9: Create the test fake — `packages/api/test/fakes/email.ts`**

```ts
import type { EmailMessage, EmailSender } from '../../src/email/sender';

export class FakeEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
  }
}
```

- [ ] **Step 10: Typecheck**

Run: `npm run --workspace @club-night/api typecheck`
Expected: exit 0.

- [ ] **Step 11: Commit**

```bash
git add packages/api/package.json packages/api/src/email packages/api/test/email packages/api/test/fakes package-lock.json
git commit -m "feat(api): add EmailSender abstraction with SES adapter and test fake"
```

---

## Task 2: Auth-code persistence (keys + repository)

**Files:**
- Modify: `packages/api/src/db/keys.ts`
- Create: `packages/api/src/repositories/auth-codes.ts`
- Test: `packages/api/test/repositories/auth-codes.test.ts`

- [ ] **Step 1: Add auth-code key builders to `packages/api/src/db/keys.ts`**

Append:

```ts
export const authCodePk = (clubId: string, emailLower: string): string =>
  `AUTHCODE#${clubId}#${emailLower}`;
export const authCodeSk = (): string => '#META';
```

- [ ] **Step 2: Write the failing repo test — `packages/api/test/repositories/auth-codes.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { putAuthCode, getAuthCode, deleteAuthCode } from '../../src/repositories/auth-codes';

beforeEach(async () => {
  await resetTable();
});

const rec = {
  clubId: 'club-1',
  email: 'ada@example.com',
  codeHash: 'abc123',
  ttl: 1_900_000_000,
};

describe('auth-codes repository', () => {
  it('stores and fetches a code record by club + email', async () => {
    await putAuthCode(rec);
    const found = await getAuthCode('club-1', 'ada@example.com');
    expect(found).toEqual(rec);
  });

  it('returns null when there is no code for that club + email', async () => {
    expect(await getAuthCode('club-1', 'nobody@example.com')).toBeNull();
  });

  it('overwrites a previous code for the same club + email', async () => {
    await putAuthCode(rec);
    await putAuthCode({ ...rec, codeHash: 'newhash' });
    const found = await getAuthCode('club-1', 'ada@example.com');
    expect(found!.codeHash).toBe('newhash');
  });

  it('deletes a code record', async () => {
    await putAuthCode(rec);
    await deleteAuthCode('club-1', 'ada@example.com');
    expect(await getAuthCode('club-1', 'ada@example.com')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/repositories/auth-codes.test.ts`
Expected: FAIL — cannot resolve `../../src/repositories/auth-codes`.

- [ ] **Step 4: Implement `packages/api/src/repositories/auth-codes.ts`**

```ts
import { DeleteCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from '../db/client';
import { authCodePk, authCodeSk } from '../db/keys';

export interface AuthCodeRecord {
  clubId: string;
  /** lowercased email */
  email: string;
  codeHash: string;
  /** epoch seconds; also the DynamoDB TTL attribute for real-DynamoDB cleanup */
  ttl: number;
}

function toItem(rec: AuthCodeRecord): Record<string, unknown> {
  return {
    PK: authCodePk(rec.clubId, rec.email),
    SK: authCodeSk(),
    ...rec,
  };
}

function fromItem(item: Record<string, any>): AuthCodeRecord {
  return {
    clubId: item.clubId,
    email: item.email,
    codeHash: item.codeHash,
    ttl: item.ttl,
  };
}

export async function putAuthCode(rec: AuthCodeRecord): Promise<void> {
  await getDocClient().send(new PutCommand({ TableName: getTableName(), Item: toItem(rec) }));
}

export async function getAuthCode(clubId: string, emailLower: string): Promise<AuthCodeRecord | null> {
  const res = await getDocClient().send(
    new GetCommand({ TableName: getTableName(), Key: { PK: authCodePk(clubId, emailLower), SK: authCodeSk() } }),
  );
  return res.Item ? fromItem(res.Item) : null;
}

export async function deleteAuthCode(clubId: string, emailLower: string): Promise<void> {
  await getDocClient().send(
    new DeleteCommand({ TableName: getTableName(), Key: { PK: authCodePk(clubId, emailLower), SK: authCodeSk() } }),
  );
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/repositories/auth-codes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/db/keys.ts packages/api/src/repositories/auth-codes.ts packages/api/test/repositories/auth-codes.test.ts
git commit -m "feat(api): add TTL'd auth-code repository for guest codes"
```

---

## Task 3: Guest code generation + hashing (pure)

**Files:**
- Create: `packages/api/src/auth/code.ts`
- Test: `packages/api/test/auth/code.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/auth/code.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { generateNumericCode, hashGuestCode } from '../../src/auth/code';

describe('generateNumericCode', () => {
  it('returns a 6-digit numeric string by default', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateNumericCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });
});

describe('hashGuestCode', () => {
  it('is deterministic for the same club, email and code', () => {
    const a = hashGuestCode('club-1', 'ada@example.com', '123456');
    const b = hashGuestCode('club-1', 'ada@example.com', '123456');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs when the code, email or club differ', () => {
    const base = hashGuestCode('club-1', 'ada@example.com', '123456');
    expect(hashGuestCode('club-1', 'ada@example.com', '654321')).not.toBe(base);
    expect(hashGuestCode('club-1', 'bob@example.com', '123456')).not.toBe(base);
    expect(hashGuestCode('club-2', 'ada@example.com', '123456')).not.toBe(base);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/code.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/code`.

- [ ] **Step 3: Implement `packages/api/src/auth/code.ts`**

```ts
import { createHash, randomInt } from 'node:crypto';

/** A cryptographically-random zero-padded numeric code (default 6 digits). */
export function generateNumericCode(digits = 6): string {
  const max = 10 ** digits;
  return randomInt(0, max).toString().padStart(digits, '0');
}

/** SHA-256 of the code salted with club + email, so codes aren't stored in the clear. */
export function hashGuestCode(clubId: string, emailLower: string, code: string): string {
  return createHash('sha256').update(`${clubId}:${emailLower}:${code}`).digest('hex');
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/code.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/code.ts packages/api/test/auth/code.test.ts
git commit -m "feat(api): add guest code generation and hashing"
```

---

## Task 4: Guest-session JWT (issue + verify)

**Files:**
- Modify: `vitest.config.ts` (add `GUEST_JWT_SECRET` to test env)
- Create: `packages/api/src/auth/guest-session.ts`
- Test: `packages/api/test/auth/guest-session.test.ts`

- [ ] **Step 1: Add `GUEST_JWT_SECRET` to the test env in `vitest.config.ts`**

Update the `env` block (keep the existing three vars):

```ts
    env: {
      DYNAMODB_ENDPOINT: 'http://localhost:8000',
      CLUB_NIGHT_TABLE: 'club-night-test',
      AWS_REGION: 'eu-west-2',
      GUEST_JWT_SECRET: 'test-guest-jwt-secret-at-least-32-bytes-long',
    },
```

- [ ] **Step 2: Write the failing test — `packages/api/test/auth/guest-session.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { issueGuestSession, verifyGuestSession } from '../../src/auth/guest-session';

describe('guest session JWT', () => {
  it('round-trips email and clubId', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    const session = await verifyGuestSession(token);
    expect(session).toEqual({ email: 'ada@example.com', clubId: 'club-1' });
  });

  it('returns null for a tampered token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' });
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await verifyGuestSession(tampered)).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const token = await issueGuestSession({ email: 'ada@example.com', clubId: 'club-1' }, -10);
    expect(await verifyGuestSession(token)).toBeNull();
  });

  it('returns null for a non-guest token', async () => {
    expect(await verifyGuestSession('not-a-jwt')).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/guest-session.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/guest-session`.

- [ ] **Step 4: Implement `packages/api/src/auth/guest-session.ts`**

```ts
import { SignJWT, jwtVerify } from 'jose';

export interface GuestSession {
  email: string;
  clubId: string;
}

const ALG = 'HS256';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function secret(): Uint8Array {
  const value = process.env.GUEST_JWT_SECRET;
  if (!value) throw new Error('GUEST_JWT_SECRET is not set');
  return new TextEncoder().encode(value);
}

export async function issueGuestSession(
  session: GuestSession,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return await new SignJWT({ email: session.email, clubId: session.clubId, typ: 'guest' })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(secret());
}

export async function verifyGuestSession(token: string): Promise<GuestSession | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    if (
      payload.typ !== 'guest' ||
      typeof payload.email !== 'string' ||
      typeof payload.clubId !== 'string'
    ) {
      return null;
    }
    return { email: payload.email, clubId: payload.clubId };
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/guest-session.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts packages/api/src/auth/guest-session.ts packages/api/test/auth/guest-session.test.ts
git commit -m "feat(api): add guest-session JWT issue and verify"
```

---

## Task 5: Guest code service (request + verify)

**Files:**
- Create: `packages/api/src/auth/guest-code-service.ts`
- Test: `packages/api/test/auth/guest-code-service.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/auth/guest-code-service.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resetTable } from '../setup/table';
import { FakeEmailSender } from '../fakes/email';
import { requestGuestCode, verifyGuestCode } from '../../src/auth/guest-code-service';
import { getAuthCode } from '../../src/repositories/auth-codes';
import { verifyGuestSession } from '../../src/auth/guest-session';

beforeEach(async () => {
  await resetTable();
});

const FIXED_NOW = 1_900_000_000;

describe('requestGuestCode', () => {
  it('stores a hashed code and emails the plaintext code', async () => {
    const email = new FakeEmailSender();
    await requestGuestCode('club-1', 'Red Dice Club', 'Ada@Example.com', {
      emailSender: email,
      now: () => FIXED_NOW,
      generateCode: () => '123456',
    });

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ada@example.com');
    expect(email.sent[0]!.text).toContain('123456');

    const record = await getAuthCode('club-1', 'ada@example.com');
    expect(record).not.toBeNull();
    expect(record!.codeHash).not.toBe('123456'); // stored hashed, not plaintext
    expect(record!.ttl).toBe(FIXED_NOW + 15 * 60);
  });
});

describe('verifyGuestCode', () => {
  async function seedCode() {
    const email = new FakeEmailSender();
    await requestGuestCode('club-1', 'Red Dice Club', 'ada@example.com', {
      emailSender: email,
      now: () => FIXED_NOW,
      generateCode: () => '123456',
    });
  }

  it('returns a guest-session token for the correct code and consumes it (single use)', async () => {
    await seedCode();
    const token = await verifyGuestCode('club-1', 'Ada@Example.com', '123456', { now: () => FIXED_NOW });
    expect(token).not.toBeNull();
    expect(await verifyGuestSession(token!)).toEqual({ email: 'ada@example.com', clubId: 'club-1' });

    // single-use: the record is gone, so a second attempt fails
    expect(await verifyGuestCode('club-1', 'ada@example.com', '123456', { now: () => FIXED_NOW })).toBeNull();
  });

  it('returns null for a wrong code and leaves the record for retry', async () => {
    await seedCode();
    expect(await verifyGuestCode('club-1', 'ada@example.com', '000000', { now: () => FIXED_NOW })).toBeNull();
    expect(await getAuthCode('club-1', 'ada@example.com')).not.toBeNull();
  });

  it('returns null for an expired code and clears it', async () => {
    await seedCode();
    const later = FIXED_NOW + 16 * 60; // past the 15-minute TTL
    expect(await verifyGuestCode('club-1', 'ada@example.com', '123456', { now: () => later })).toBeNull();
    expect(await getAuthCode('club-1', 'ada@example.com')).toBeNull();
  });

  it('returns null when no code was requested', async () => {
    expect(await verifyGuestCode('club-1', 'nobody@example.com', '123456', { now: () => FIXED_NOW })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/auth/guest-code-service.test.ts`
Expected: FAIL — cannot resolve `../../src/auth/guest-code-service`.

- [ ] **Step 3: Implement `packages/api/src/auth/guest-code-service.ts`**

```ts
import type { EmailSender } from '../email/sender';
import { deleteAuthCode, getAuthCode, putAuthCode } from '../repositories/auth-codes';
import { generateNumericCode, hashGuestCode } from './code';
import { issueGuestSession } from './guest-session';

const CODE_TTL_SECONDS = 15 * 60;

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export interface RequestCodeDeps {
  emailSender: EmailSender;
  now?: () => number;
  generateCode?: () => string;
}

/** Generate a one-time code for this club+email, store it hashed with a TTL, and email the plaintext. */
export async function requestGuestCode(
  clubId: string,
  clubName: string,
  email: string,
  deps: RequestCodeDeps,
): Promise<void> {
  const emailLower = email.toLowerCase();
  const now = deps.now ?? nowSeconds;
  const generate = deps.generateCode ?? (() => generateNumericCode());
  const code = generate();

  await putAuthCode({
    clubId,
    email: emailLower,
    codeHash: hashGuestCode(clubId, emailLower, code),
    ttl: now() + CODE_TTL_SECONDS,
  });

  await deps.emailSender.send({
    to: emailLower,
    subject: `Your ${clubName} sign-in code`,
    text: `Your code is ${code}. It expires in 15 minutes.`,
  });
}

export interface VerifyCodeDeps {
  now?: () => number;
}

/**
 * Verify a submitted code. On success, consume it (single-use) and return a guest-session
 * JWT. Returns null when there is no code, it has expired, or the code is wrong.
 */
export async function verifyGuestCode(
  clubId: string,
  email: string,
  code: string,
  deps: VerifyCodeDeps = {},
): Promise<string | null> {
  const emailLower = email.toLowerCase();
  const now = deps.now ?? nowSeconds;

  const record = await getAuthCode(clubId, emailLower);
  if (!record) return null;

  if (record.ttl <= now()) {
    await deleteAuthCode(clubId, emailLower);
    return null;
  }

  if (record.codeHash !== hashGuestCode(clubId, emailLower, code)) {
    return null;
  }

  await deleteAuthCode(clubId, emailLower);
  return await issueGuestSession({ email: emailLower, clubId });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/auth/guest-code-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/auth/guest-code-service.ts packages/api/test/auth/guest-code-service.test.ts
git commit -m "feat(api): add guest code request and verify service"
```

---

## Task 6: Guest endpoints (request-code, verify-code)

**Files:**
- Modify: `packages/api/src/http/errors.ts` (add `UnauthorizedError`)
- Create: `packages/api/src/routes/guest.ts`
- Modify: `packages/api/src/app.ts` (mount `guestRoutes`)
- Test: `packages/api/test/routes/guest.test.ts`

- [ ] **Step 1: Add `UnauthorizedError` to `packages/api/src/http/errors.ts`**

Append (after the existing error classes):

```ts
export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, 'UNAUTHORIZED', message);
  }
}
```

- [ ] **Step 2: Write the failing route test — `packages/api/test/routes/guest.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from '../setup/table';
import { sampleClub } from '../fixtures';
import { putClub } from '../../src/repositories/clubs';
import { setEmailSender } from '../../src/email/provider';
import { FakeEmailSender } from '../fakes/email';
import { verifyGuestSession } from '../../src/auth/guest-session';
import { createApp } from '../../src/app';

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

function requestCode(body: unknown) {
  return createApp().request('/clubs/red-dice/guest/request-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function verifyCode(body: unknown) {
  return createApp().request('/clubs/red-dice/guest/verify-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('guest code endpoints', () => {
  it('emails a code on request and exchanges it for a session token', async () => {
    const reqRes = await requestCode({ email: 'Ada@Example.com' });
    expect(reqRes.status).toBe(200);
    expect(email.sent).toHaveLength(1);
    const code = email.sent[0]!.text.match(/(\d{6})/)![1]!;

    const verRes = await verifyCode({ email: 'ada@example.com', code });
    expect(verRes.status).toBe(200);
    const token = ((await verRes.json()) as { token: string }).token;
    expect(await verifyGuestSession(token)).toEqual({ email: 'ada@example.com', clubId: 'club-1' });
  });

  it('rejects a wrong code with 401', async () => {
    await requestCode({ email: 'ada@example.com' });
    const res = await verifyCode({ email: 'ada@example.com', code: '000000' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an already-used code with 401 (single use)', async () => {
    await requestCode({ email: 'ada@example.com' });
    const code = email.sent[0]!.text.match(/(\d{6})/)![1]!;
    await verifyCode({ email: 'ada@example.com', code });
    const second = await verifyCode({ email: 'ada@example.com', code });
    expect(second.status).toBe(401);
  });

  it('validates the request body (400 on bad email)', async () => {
    const res = await requestCode({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when the club does not exist', async () => {
    const res = await createApp().request('/clubs/missing/guest/request-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ada@example.com' }),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/guest.test.ts`
Expected: FAIL — cannot resolve `../../src/routes/guest`.

- [ ] **Step 4: Implement `packages/api/src/routes/guest.ts`**

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { requireClubBySlug } from './context';
import { parseOrThrow } from '../http/validate';
import { UnauthorizedError } from '../http/errors';
import { getEmailSender } from '../email/provider';
import { requestGuestCode, verifyGuestCode } from '../auth/guest-code-service';

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

const verifySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  code: z.string().trim().min(1),
});

export const guestRoutes = new Hono();

guestRoutes.post('/clubs/:slug/guest/request-code', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const { email } = parseOrThrow(requestSchema, await c.req.json().catch(() => ({})));
  await requestGuestCode(club.clubId, club.name, email, { emailSender: getEmailSender() });
  // Always 200 — never reveal whether the email already has a signup.
  return c.json({ ok: true });
});

guestRoutes.post('/clubs/:slug/guest/verify-code', async (c) => {
  const club = await requireClubBySlug(c.req.param('slug'));
  const { email, code } = parseOrThrow(verifySchema, await c.req.json().catch(() => ({})));
  const token = await verifyGuestCode(club.clubId, email, code);
  if (!token) throw new UnauthorizedError('Invalid or expired code');
  return c.json({ token });
});
```

- [ ] **Step 5: Mount `guestRoutes` in `packages/api/src/app.ts`**

Add the import and the mount (full file):

```ts
import { Hono } from 'hono';
import { onError } from './http/error-handler';
import { clubRoutes } from './routes/clubs';
import { nightRoutes } from './routes/nights';
import { signupRoutes } from './routes/signups';
import { guestRoutes } from './routes/guest';

export function createApp(): Hono {
  const app = new Hono();
  app.onError(onError);
  app.notFound((c) => c.json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404));

  app.route('/', clubRoutes);
  app.route('/', nightRoutes);
  app.route('/', signupRoutes);
  app.route('/', guestRoutes);

  return app;
}
```

- [ ] **Step 6: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/guest.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New tests this slice: ses-sender 1, auth-codes 4, code 3, guest-session 4, guest-code-service 5, guest-route 5 = **22**. Added to slice-2's 62 → **84 total**. Typecheck clean for both packages.

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/http/errors.ts packages/api/src/routes/guest.ts packages/api/src/app.ts packages/api/test/routes/guest.test.ts
git commit -m "feat(api): add guest request-code and verify-code endpoints"
```

---

## Done criteria

- `npm test` passes (84 tests: 62 prior + 22 new).
- `npm run typecheck` passes for both packages.
- A guest can `POST /clubs/:slug/guest/request-code` (emailed a 6-digit code, stored hashed with a 15-minute TTL) and exchange it via `POST /clubs/:slug/guest/verify-code` for a 30-day guest-session JWT; codes are single-use and expire.
- The `EmailSender` abstraction has a real SES adapter and an overridable provider so later slices (signup confirmation, pairing emails) reuse it.
- Cognito verification, memberships, the principal middleware, authorization helpers, and the protected endpoints remain for slice 3b.
