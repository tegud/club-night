# Scheduling Glue & Cold-Start Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make auto-pair-at-deadline real: a `Scheduler` abstraction that creates/deletes a one-shot EventBridge schedule per night, a scheduled-Lambda handler that runs `runDeadlinePairing`, wiring into the organizer night create/cancel routes, and a fail-fast env-config assertion at cold start.

**Architecture:** A `Scheduler` interface behind an overridable provider (real `@aws-sdk/client-scheduler` impl + test fake), a `scheduled-handler.ts` Lambda entry that calls `runDeadlinePairing(clubId, nightId)`, best-effort schedule create-on-night-create / delete-on-cancel, and an `assertAppConfig()` guard invoked at module load in both Lambda entry points. Mirrors the existing `EmailSender`/`getEmailSender`/`setEmailSender` provider pattern.

**Tech Stack:** TypeScript, `@aws-sdk/client-scheduler`, Hono, Vitest, dynalite (test).

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Pairing engine — EventBridge Scheduler; § Internal — scheduled invoke).
**Builds on:** slices 1–3d-iii — 196 tests passing. `runDeadlinePairing`, `getEmailSender`/`setEmailSender`, the organizer night routes, and `handler.ts` all exist.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Scope:** application glue + config only. The CDK stack that provisions the table, Lambdas, Cognito, SES, the EventBridge Scheduler group + IAM role, and wires env vars is slice 4b. Schedule create is **best-effort** (a scheduler failure logs and does not fail night creation — the organizer can always pair manually). Rescheduling when an organizer changes `signupDeadline` via PATCH is a carry-forward (create-on-create + delete-on-cancel only here).

---

## File structure produced by this plan

```
packages/api/
  package.json                         (MODIFY: add @aws-sdk/client-scheduler)
  src/
    config/app-config.ts               assertAppConfig() — fail-fast required-env guard
    scheduling/
      scheduler.ts                     Scheduler interface
      eventbridge-scheduler.ts         EventBridgeScheduler (real impl, injectable client)
      provider.ts                      getScheduler() / setScheduler()
    scheduled-handler.ts               Lambda entry → runDeadlinePairing
    handler.ts                         (MODIFY: assertAppConfig() at module load)
    routes/organizer-nights.ts         (MODIFY: create schedule on create, delete on cancel)
  test/
    fakes/scheduler.ts                 FakeScheduler
    config/app-config.test.ts
    scheduling/eventbridge-scheduler.test.ts
    scheduled-handler.test.ts
    routes/organizer-nights.test.ts    (MODIFY: scheduler create/cancel assertions)
vitest.config.ts                       (MODIFY: add dummy EMAIL_FROM + COGNITO_* test env)
```

---

## Task 1: Fail-fast app-config assertion

**Files:**
- Create: `packages/api/src/config/app-config.ts`
- Modify: `vitest.config.ts`
- Test: `packages/api/test/config/app-config.test.ts`

- [ ] **Step 1: Add dummy required envs to the test env in `vitest.config.ts`**

So the Lambda entry points (which call `assertAppConfig()` at module load) can be imported in tests. Extend the existing `env` block (keep the existing vars):

```ts
    env: {
      DYNAMODB_ENDPOINT: 'http://localhost:8000',
      CLUB_NIGHT_TABLE: 'club-night-test',
      AWS_REGION: 'eu-west-2',
      GUEST_JWT_SECRET: 'test-guest-jwt-secret-at-least-32-bytes-long',
      EMAIL_FROM: 'no-reply@club-night.test',
      COGNITO_USER_POOL_ID: 'test-pool',
      COGNITO_CLIENT_ID: 'test-client',
    },
```

(The Cognito tests always override the verifier, so dummy `COGNITO_*` values are never used to build a real verifier; `EMAIL_FROM` is unused because tests inject a fake sender.)

- [ ] **Step 2: Write the failing test — `packages/api/test/config/app-config.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assertAppConfig } from '../../src/config/app-config';

const complete = {
  GUEST_JWT_SECRET: 'x'.repeat(40),
  EMAIL_FROM: 'no-reply@club.test',
  COGNITO_USER_POOL_ID: 'pool',
  COGNITO_CLIENT_ID: 'client',
  CLUB_NIGHT_TABLE: 'club-night',
};

describe('assertAppConfig', () => {
  it('passes when all required vars are present', () => {
    expect(() => assertAppConfig(complete)).not.toThrow();
  });

  it('throws listing every missing required var', () => {
    try {
      assertAppConfig({ CLUB_NIGHT_TABLE: 'club-night' });
      throw new Error('should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('GUEST_JWT_SECRET');
      expect(message).toContain('EMAIL_FROM');
      expect(message).toContain('COGNITO_USER_POOL_ID');
      expect(message).toContain('COGNITO_CLIENT_ID');
      expect(message).not.toContain('CLUB_NIGHT_TABLE');
    }
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run packages/api/test/config/app-config.test.ts`
Expected: FAIL — cannot resolve `../../src/config/app-config`.

- [ ] **Step 4: Implement `packages/api/src/config/app-config.ts`**

```ts
const REQUIRED_ENV = [
  'GUEST_JWT_SECRET',
  'EMAIL_FROM',
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
  'CLUB_NIGHT_TABLE',
] as const;

/**
 * Fail fast at cold start if the deployed Lambda is misconfigured. Without this a
 * missing COGNITO_* silently 401s every organizer request, and a missing
 * GUEST_JWT_SECRET 500s guest verification — both confusing in production.
 */
export function assertAppConfig(env: Record<string, string | undefined> = process.env): void {
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `npx vitest run packages/api/test/config/app-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/config/app-config.ts packages/api/test/config/app-config.test.ts vitest.config.ts
git commit -m "feat(api): add fail-fast app-config assertion"
```

---

## Task 2: Scheduler interface, provider, and test fake

**Files:**
- Modify: `packages/api/package.json`
- Create: `packages/api/src/scheduling/scheduler.ts`
- Create: `packages/api/src/scheduling/provider.ts`
- Create: `packages/api/test/fakes/scheduler.ts`

> The real `EventBridgeScheduler` impl lands in Task 3. `provider.ts` imports it, so this task creates a minimal `eventbridge-scheduler.ts` stub first OR Task 3 is done before the provider is used — to keep TDD clean, create the provider here pointing at the impl, and the impl in Task 3 (the provider isn't exercised until the route wiring in Task 5, by which point Task 3 has landed).

- [ ] **Step 1: Add `@aws-sdk/client-scheduler` to `packages/api/package.json` dependencies**

Add `"@aws-sdk/client-scheduler": "^3.637.0"` to the `dependencies` block. Then run `npm install`.

- [ ] **Step 2: Create `packages/api/src/scheduling/scheduler.ts`**

```ts
export interface Scheduler {
  /** Create a one-shot schedule that fires at `runAtIso` (ISO 8601) to auto-pair the night. */
  createNightSchedule(clubId: string, nightId: string, runAtIso: string): Promise<void>;
  /** Delete a night's schedule (e.g. on cancellation). No-op if it doesn't exist. */
  deleteNightSchedule(clubId: string, nightId: string): Promise<void>;
}
```

- [ ] **Step 3: Create the test fake — `packages/api/test/fakes/scheduler.ts`**

```ts
import type { Scheduler } from '../../src/scheduling/scheduler';

export class FakeScheduler implements Scheduler {
  readonly created: { clubId: string; nightId: string; runAtIso: string }[] = [];
  readonly deleted: { clubId: string; nightId: string }[] = [];

  async createNightSchedule(clubId: string, nightId: string, runAtIso: string): Promise<void> {
    this.created.push({ clubId, nightId, runAtIso });
  }

  async deleteNightSchedule(clubId: string, nightId: string): Promise<void> {
    this.deleted.push({ clubId, nightId });
  }
}
```

- [ ] **Step 4: Create the provider — `packages/api/src/scheduling/provider.ts`**

```ts
import type { Scheduler } from './scheduler';
import { EventBridgeScheduler } from './eventbridge-scheduler';

let scheduler: Scheduler | undefined;

export function getScheduler(): Scheduler {
  if (!scheduler) scheduler = new EventBridgeScheduler();
  return scheduler;
}

/** Override the scheduler (used by tests). Pass undefined to reset to the default. */
export function setScheduler(next: Scheduler | undefined): void {
  scheduler = next;
}
```

- [ ] **Step 5: Verify install + typecheck deferred**

Run: `npm install`
Expected: `@aws-sdk/client-scheduler` resolves. (Typecheck will fail until Task 3 creates `eventbridge-scheduler.ts` — that's expected; the next task completes it. Do NOT run a full typecheck yet.)

- [ ] **Step 6: Commit**

```bash
git add packages/api/package.json packages/api/src/scheduling/scheduler.ts packages/api/src/scheduling/provider.ts packages/api/test/fakes/scheduler.ts package-lock.json
git commit -m "feat(api): add Scheduler interface, provider and test fake"
```

---

## Task 3: EventBridge Scheduler implementation

**Files:**
- Create: `packages/api/src/scheduling/eventbridge-scheduler.ts`
- Test: `packages/api/test/scheduling/eventbridge-scheduler.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/scheduling/eventbridge-scheduler.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { EventBridgeScheduler } from '../../src/scheduling/eventbridge-scheduler';

const config = { groupName: 'club-night', targetArn: 'arn:lambda:pairer', roleArn: 'arn:role:sched' };

describe('EventBridgeScheduler', () => {
  it('creates a one-shot UTC schedule targeting the pairing lambda with the night payload', async () => {
    const sent: { input: unknown }[] = [];
    const stubClient = { send: async (command: { input: unknown }) => { sent.push(command); return {}; } };
    const scheduler = new EventBridgeScheduler(stubClient as never, config);

    await scheduler.createNightSchedule('club-1', 'night-1', '2026-07-02T12:00:00.000Z');

    expect(sent).toHaveLength(1);
    const input = sent[0]!.input as {
      Name: string; GroupName: string; ScheduleExpression: string; ScheduleExpressionTimezone: string;
      FlexibleTimeWindow: { Mode: string }; ActionAfterCompletion: string;
      Target: { Arn: string; RoleArn: string; Input: string };
    };
    expect(input.Name).toBe('clubnight-night-1');
    expect(input.GroupName).toBe('club-night');
    expect(input.ScheduleExpression).toBe('at(2026-07-02T12:00:00)');
    expect(input.ScheduleExpressionTimezone).toBe('UTC');
    expect(input.FlexibleTimeWindow.Mode).toBe('OFF');
    expect(input.ActionAfterCompletion).toBe('DELETE');
    expect(input.Target.Arn).toBe('arn:lambda:pairer');
    expect(input.Target.RoleArn).toBe('arn:role:sched');
    expect(JSON.parse(input.Target.Input)).toEqual({ clubId: 'club-1', nightId: 'night-1' });
  });

  it('deletes a schedule by name', async () => {
    const sent: { input: unknown }[] = [];
    const stubClient = { send: async (command: { input: unknown }) => { sent.push(command); return {}; } };
    const scheduler = new EventBridgeScheduler(stubClient as never, config);

    await scheduler.deleteNightSchedule('club-1', 'night-1');

    expect(sent).toHaveLength(1);
    expect((sent[0]!.input as { Name: string }).Name).toBe('clubnight-night-1');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/scheduling/eventbridge-scheduler.test.ts`
Expected: FAIL — cannot resolve `../../src/scheduling/eventbridge-scheduler`.

- [ ] **Step 3: Implement `packages/api/src/scheduling/eventbridge-scheduler.ts`**

```ts
import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import type { Scheduler } from './scheduler';

export interface SchedulerConfig {
  groupName: string;
  targetArn: string;
  roleArn: string;
}

function loadSchedulerConfig(): SchedulerConfig {
  return {
    groupName: process.env.SCHEDULER_GROUP ?? 'club-night',
    targetArn: process.env.SCHEDULER_TARGET_ARN ?? '',
    roleArn: process.env.SCHEDULER_ROLE_ARN ?? '',
  };
}

function scheduleName(nightId: string): string {
  return `clubnight-${nightId}`;
}

export class EventBridgeScheduler implements Scheduler {
  constructor(
    private readonly client: SchedulerClient = new SchedulerClient({}),
    private readonly config: SchedulerConfig = loadSchedulerConfig(),
  ) {}

  async createNightSchedule(clubId: string, nightId: string, runAtIso: string): Promise<void> {
    await this.client.send(
      new CreateScheduleCommand({
        Name: scheduleName(nightId),
        GroupName: this.config.groupName,
        // One-shot: EventBridge `at()` takes a timezone-naive timestamp (strip ms + Z).
        ScheduleExpression: `at(${runAtIso.slice(0, 19)})`,
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE', // auto-remove the one-shot after it fires
        Target: {
          Arn: this.config.targetArn,
          RoleArn: this.config.roleArn,
          Input: JSON.stringify({ clubId, nightId }),
        },
      }),
    );
  }

  async deleteNightSchedule(_clubId: string, nightId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteScheduleCommand({ Name: scheduleName(nightId), GroupName: this.config.groupName }),
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
    }
  }
}
```

- [ ] **Step 4: Run it to verify it passes + typecheck**

Run: `npx vitest run packages/api/test/scheduling/eventbridge-scheduler.test.ts && npm run --workspace @club-night/api typecheck`
Expected: PASS (2 tests); typecheck clean (the provider from Task 2 now resolves).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/scheduling/eventbridge-scheduler.ts packages/api/test/scheduling/eventbridge-scheduler.test.ts
git commit -m "feat(api): add EventBridge one-shot scheduler implementation"
```

---

## Task 4: Scheduled-pairing Lambda handler

**Files:**
- Create: `packages/api/src/scheduled-handler.ts`
- Test: `packages/api/test/scheduled-handler.test.ts`

- [ ] **Step 1: Write the failing test — `packages/api/test/scheduled-handler.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetTable } from './setup/table';
import { sampleNight, sampleMembership } from './fixtures';
import { putNight, getNight } from '../src/repositories/nights';
import { putMembership } from '../src/repositories/memberships';
import { upsertSignup } from '../src/repositories/signups';
import { listPairingsByNight } from '../src/repositories/pairings';
import { setEmailSender } from '../src/email/provider';
import { FakeEmailSender } from './fakes/email';
import { handler } from '../src/scheduled-handler';

let email: FakeEmailSender;

beforeEach(async () => {
  await resetTable();
  email = new FakeEmailSender();
  setEmailSender(email);
  await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN', createdBy: 'user-1' }));
  await putMembership(sampleMembership({ clubId: 'club-1', userId: 'user-1', email: 'olivia@example.com' }));
  await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Ada', email: 'a@x.com', systemKey: 'WARHAMMER_40K' });
  await upsertSignup({ nightId: 'night-1', clubId: 'club-1', playerName: 'Bob', email: 'b@x.com', systemKey: 'WARHAMMER_40K' });
});

afterEach(() => {
  setEmailSender(undefined);
});

describe('scheduled-handler', () => {
  it('runs the deadline pairing for the event payload', async () => {
    await handler({ clubId: 'club-1', nightId: 'night-1' });
    expect((await getNight('club-1', 'night-1'))!.status).toBe('CLOSED');
    expect(await listPairingsByNight('night-1')).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('olivia@example.com');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/scheduled-handler.test.ts`
Expected: FAIL — cannot resolve `../src/scheduled-handler`.

- [ ] **Step 3: Implement `packages/api/src/scheduled-handler.ts`**

```ts
import { assertAppConfig } from './config/app-config';
import { runDeadlinePairing } from './services/pairing-service';

assertAppConfig();

export interface ScheduledPairingEvent {
  clubId: string;
  nightId: string;
}

/** Invoked by EventBridge Scheduler at a night's signupDeadline. */
export async function handler(event: ScheduledPairingEvent): Promise<void> {
  await runDeadlinePairing(event.clubId, event.nightId);
}
```

(The `assertAppConfig()` at module load fails the Lambda fast if misconfigured. The test env in `vitest.config.ts` supplies all required vars, so importing this module in the test does not throw.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/scheduled-handler.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/scheduled-handler.ts packages/api/test/scheduled-handler.test.ts
git commit -m "feat(api): add scheduled-pairing lambda handler"
```

---

## Task 5: Wire schedule create/delete into the organizer night routes

**Files:**
- Modify: `packages/api/src/routes/organizer-nights.ts`
- Modify: `packages/api/test/routes/organizer-nights.test.ts`

- [ ] **Step 1: Add failing tests to `packages/api/test/routes/organizer-nights.test.ts`**

Add imports (`setScheduler` from `../../src/scheduling/provider`, `FakeScheduler` from `../fakes/scheduler`), install the fake in `beforeEach` + reset in `afterEach`, then add assertions. Add to the top-level `beforeEach`:

```ts
import { setScheduler } from '../../src/scheduling/provider';
import { FakeScheduler } from '../fakes/scheduler';

// ...in the existing beforeEach, after the existing setup:
  scheduler = new FakeScheduler();
  setScheduler(scheduler);
// ...declare `let scheduler: FakeScheduler;` near the top, and add:
// afterEach(() => setScheduler(undefined));
```

Then add tests:

```ts
describe('night scheduling', () => {
  it('creates an EventBridge schedule when a night is created', async () => {
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(201);
    const nightId = (await res.json() as any).night.nightId;
    expect(scheduler.created).toHaveLength(1);
    expect(scheduler.created[0]).toMatchObject({ clubId: 'club-1', nightId, runAtIso: validBody.signupDeadline });
  });

  it('deletes the schedule when a night is cancelled', async () => {
    await putNight(sampleNight({ nightId: 'night-1', status: 'OPEN' }));
    const res = await updateNight('night-1', { status: 'CANCELLED' }, ORGANIZER_TOKEN);
    expect(res.status).toBe(200);
    expect(scheduler.deleted).toContainEqual({ clubId: 'club-1', nightId: 'night-1' });
  });

  it('still creates the night (201) when scheduling fails', async () => {
    setScheduler({
      createNightSchedule: async () => { throw new Error('scheduler down'); },
      deleteNightSchedule: async () => {},
    });
    const res = await createNight(validBody, ORGANIZER_TOKEN);
    expect(res.status).toBe(201);
  });
});
```

(`createNight`, `updateNight`, `validBody`, `ORGANIZER_TOKEN`, `putNight`, `sampleNight` already exist in this file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: FAIL — no schedule is created/deleted yet.

- [ ] **Step 3: Wire the scheduler into `packages/api/src/routes/organizer-nights.ts`**

Add `import { getScheduler } from '../scheduling/provider';`. In the POST create handler, after `await putNight(night);` and before the response, best-effort create the schedule:

```ts
  try {
    await getScheduler().createNightSchedule(club.clubId, night.nightId, night.signupDeadline);
  } catch (err) {
    // Best-effort: a scheduler failure must not fail night creation (organizers can pair manually).
    console.error('Failed to create night schedule', err);
  }
```

In the PATCH handler, after `await putNight(updated);` and before the response, delete the schedule if the night is now cancelled:

```ts
  if (updated.status === 'CANCELLED') {
    try {
      await getScheduler().deleteNightSchedule(club.clubId, updated.nightId);
    } catch (err) {
      console.error('Failed to delete night schedule', err);
    }
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/api/test/routes/organizer-nights.test.ts`
Expected: PASS (the prior organizer-nights tests + 3 new scheduling tests). Note: the prior tests now also run with a `FakeScheduler` installed — confirm they still pass (the fake just records calls).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/organizer-nights.ts packages/api/test/routes/organizer-nights.test.ts
git commit -m "feat(api): create/delete night schedules on create/cancel"
```

---

## Task 6: Fail-fast config in the HTTP Lambda entry

**Files:**
- Modify: `packages/api/src/handler.ts`

- [ ] **Step 1: Add `assertAppConfig()` at module load in `packages/api/src/handler.ts`**

```ts
import { handle } from 'hono/aws-lambda';
import { assertAppConfig } from './config/app-config';
import { createApp } from './app';

assertAppConfig();

export const handler = handle(createApp());
```

- [ ] **Step 2: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New this slice: app-config 2, eventbridge-scheduler 2, scheduled-handler 1, organizer-nights scheduling 3 = **8**. Added to 196 → **204 total**. Typecheck clean for both packages.

> No test imports `handler.ts`, so the module-load `assertAppConfig()` there is never triggered during tests; the `vitest.config.ts` env additions (Task 1) cover the `scheduled-handler.ts` import which IS exercised by a test.

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/handler.ts
git commit -m "feat(api): fail fast on missing config in the http lambda entry"
```

---

## Done criteria

- `npm test` passes (204 tests) and `npm run typecheck` is clean for both packages.
- A `Scheduler` abstraction creates a one-shot UTC EventBridge schedule (`at(...)`, auto-delete after firing, target = the pairing Lambda, input = `{clubId, nightId}`) and deletes it by name; behind an overridable provider with a test fake.
- Creating a night best-effort-schedules its auto-pair at `signupDeadline`; cancelling a night deletes the schedule; scheduling failures never fail the night operation.
- `scheduled-handler.ts` is the EventBridge target — it runs `runDeadlinePairing(clubId, nightId)`.
- Both Lambda entry points (`handler.ts`, `scheduled-handler.ts`) fail fast at cold start if required env (`GUEST_JWT_SECRET`, `EMAIL_FROM`, `COGNITO_*`, `CLUB_NIGHT_TABLE`) is missing.
- Carry-forwards for slice 4b (CDK): provision the EventBridge Scheduler group + an IAM role the scheduler assumes to invoke the pairing Lambda, set `SCHEDULER_GROUP`/`SCHEDULER_TARGET_ARN`/`SCHEDULER_ROLE_ARN` + the required app env on both Lambdas, grant the API Lambda `scheduler:CreateSchedule`/`DeleteSchedule`, and point the scheduled-handler Lambda at `scheduled-handler.handler`. Also: rescheduling on a `signupDeadline` PATCH change is not handled (organizer would need to cancel + recreate).
