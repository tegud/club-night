# CDK Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provision the deployable AWS infrastructure for Club Night as an AWS CDK (TypeScript) stack: the single DynamoDB table (with TTL + 3 GSIs), Cognito user pool, the HTTP API Lambda (Function URL) and the scheduled-pairing Lambda, the EventBridge Scheduler group + invoke role, and all IAM + env wiring — unit-tested via CDK `Template` assertions.

**Architecture:** A new `packages/infra` workspace holding one `ClubNightStack`. Both Lambdas are `NodejsFunction`s bundling the existing `packages/api` handlers (`handler.ts`, `scheduled-handler.ts`). The API Lambda gets a Function URL (auth NONE — the app does its own auth) and IAM to create/delete EventBridge schedules; the scheduler assumes a role to invoke the scheduled Lambda. Tests synthesize the stack with bundling disabled and assert resource properties — no AWS account or Docker needed.

**Tech Stack:** AWS CDK v2 (`aws-cdk-lib`), `constructs`, `NodejsFunction` (esbuild), Vitest + `aws-cdk-lib/assertions`.

**Source spec:** `docs/superpowers/specs/2026-06-11-club-night-design.md` (§ Tech stack; § single-table; § Auth; § Pairing — EventBridge).
**Builds on:** slices 1–4a — 208 tests passing. The app's deploy contract (env vars per Lambda, scheduler ARNs, handler paths) is fixed by slice 4a; this stack satisfies it.

> **Commit note:** TDD with frequent commits as discrete steps. The repo owner controls commits — treat each "Commit" step as theirs to run (or batch), not auto-commit.

> **Testing approach:** CDK assertion tests instantiate the stack inside `new App({ context: { 'aws:cdk:bundling-stacks': [] } })` to skip Lambda bundling (fast, no esbuild/Docker needed at test time), then assert against `Template.fromStack(stack)`. Resource *properties* (env, handler, runtime, IAM, TTL, GSIs) are present in the template regardless of asset bundling.

> **CDK version note:** Use the latest `aws-cdk-lib` 2.x. A few construct prop names can shift between minor versions; if a property name in this plan doesn't compile, consult the installed `aws-cdk-lib` types and adjust — the assertion tests (synth) will surface any mismatch immediately.

---

## File structure produced by this plan

```
packages/infra/
  package.json
  tsconfig.json
  cdk.json
  bin/app.ts                       CDK app entry → instantiates ClubNightStack
  src/club-night-stack.ts          the stack (built up across tasks)
  test/club-night-stack.test.ts    Template assertions (grows per task)
  DEPLOY.md                        deploy runbook
```

`packages/infra` is auto-included by the root `packages/*` workspace glob, and its `test/**/*.test.ts` is picked up by the root Vitest run (the dynalite global-setup is harmless for these synth-only tests).

---

## Task 1: Infra package skeleton + empty stack that synthesizes

**Files:**
- Create: `packages/infra/package.json`, `tsconfig.json`, `cdk.json`, `bin/app.ts`, `src/club-night-stack.ts`
- Test: `packages/infra/test/club-night-stack.test.ts`

- [ ] **Step 1: Create `packages/infra/package.json`**

```json
{
  "name": "@club-night/infra",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "cdk": "cdk"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.160.0",
    "constructs": "^10.3.0"
  },
  "devDependencies": {
    "aws-cdk": "^2.160.0",
    "esbuild": "^0.23.1",
    "tsx": "^4.19.0"
  }
}
```

- [ ] **Step 2: Create `packages/infra/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "bin"]
}
```

- [ ] **Step 3: Create `packages/infra/cdk.json`**

```json
{
  "app": "npx tsx bin/app.ts"
}
```

- [ ] **Step 4: Create the initial (empty) stack — `packages/infra/src/club-night-stack.ts`**

```ts
import { Stack, type StackProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export class ClubNightStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
  }
}
```

- [ ] **Step 5: Create the app entry — `packages/infra/bin/app.ts`**

```ts
import { App } from 'aws-cdk-lib';
import { ClubNightStack } from '../src/club-night-stack';

const app = new App();
new ClubNightStack(app, 'ClubNightStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
```

- [ ] **Step 6: Install**

Run: `npm install`
Expected: `aws-cdk-lib`, `constructs`, `aws-cdk`, `esbuild`, `tsx` resolve under `node_modules/`.

- [ ] **Step 7: Write the smoke test — `packages/infra/test/club-night-stack.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { ClubNightStack } from '../src/club-night-stack';

function synth(): Template {
  // Disable Lambda bundling during synth so tests are fast and need no esbuild/Docker run.
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new ClubNightStack(app, 'TestStack');
  return Template.fromStack(stack);
}

describe('ClubNightStack', () => {
  it('synthesizes', () => {
    expect(() => synth()).not.toThrow();
  });
});
```

- [ ] **Step 8: Run it to verify it passes + typecheck**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts && npm run --workspace @club-night/infra typecheck`
Expected: PASS (1 test); typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/infra package-lock.json
git commit -m "chore(infra): add CDK infra package skeleton"
```

---

## Task 2: DynamoDB single table (TTL + 3 GSIs)

**Files:**
- Modify: `packages/infra/src/club-night-stack.ts`
- Modify: `packages/infra/test/club-night-stack.test.ts`

- [ ] **Step 1: Add failing assertions to the test**

Add a `Match` import and tests:

```ts
import { Match } from 'aws-cdk-lib/assertions';

describe('DynamoDB table', () => {
  it('is a single PAY_PER_REQUEST table with TTL on `ttl`', () => {
    const t = synth();
    t.resourceCountIs('AWS::DynamoDB::Table', 1);
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      BillingMode: 'PAY_PER_REQUEST',
      TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
      KeySchema: Match.arrayWith([
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ]),
    });
  });

  it('defines three GSIs (GSI1, GSI2, GSI3)', () => {
    const t = synth();
    t.hasResourceProperties('AWS::DynamoDB::Table', {
      GlobalSecondaryIndexes: Match.arrayWith([
        Match.objectLike({ IndexName: 'GSI1' }),
        Match.objectLike({ IndexName: 'GSI2' }),
        Match.objectLike({ IndexName: 'GSI3' }),
      ]),
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: FAIL — no DynamoDB table yet.

- [ ] **Step 3: Add the table to `packages/infra/src/club-night-stack.ts`**

```ts
import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';

export class ClubNightStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.RETAIN,
    });

    for (const n of ['GSI1', 'GSI2', 'GSI3'] as const) {
      table.addGlobalSecondaryIndex({
        indexName: n,
        partitionKey: { name: `${n}PK`, type: dynamodb.AttributeType.STRING },
        sortKey: { name: `${n}SK`, type: dynamodb.AttributeType.STRING },
      });
    }

    // `table` is used by later tasks (Lambdas). Stored on the instance to keep tasks additive.
    this.table = table;
  }

  readonly table: dynamodb.Table;
}
```

> Note: assigning `this.table` after `super()` with a `readonly` field declared below — TypeScript allows this (definite assignment in the constructor). If your tsconfig flags it, declare `readonly table: dynamodb.Table;` and assign in the constructor as shown.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: PASS (synth + 2 table tests).

- [ ] **Step 5: Commit**

```bash
git add packages/infra/src/club-night-stack.ts packages/infra/test/club-night-stack.test.ts
git commit -m "feat(infra): add single-table DynamoDB with TTL and 3 GSIs"
```

---

## Task 3: Cognito user pool + client

**Files:**
- Modify: `packages/infra/src/club-night-stack.ts`
- Modify: `packages/infra/test/club-night-stack.test.ts`

- [ ] **Step 1: Add failing assertions**

```ts
describe('Cognito', () => {
  it('creates a user pool and an app client', () => {
    const t = synth();
    t.resourceCountIs('AWS::Cognito::UserPool', 1);
    t.resourceCountIs('AWS::Cognito::UserPoolClient', 1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: FAIL — no Cognito resources.

- [ ] **Step 3: Add Cognito to the stack**

Add the import and, inside the constructor (after the table), the pool + client. Store them on the instance for later env wiring:

```ts
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
```

```ts
    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const userPoolClient = userPool.addClient('WebClient', {
      authFlows: { userPassword: true, userSrp: true },
      idTokenValidity: Duration.hours(8),
    });
    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
```

Declare the fields alongside `table`:

```ts
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/infra/src/club-night-stack.ts packages/infra/test/club-night-stack.test.ts
git commit -m "feat(infra): add Cognito user pool and web client"
```

---

## Task 4: The two Lambdas (API + scheduled) with table + SES access

**Files:**
- Modify: `packages/infra/src/club-night-stack.ts`
- Modify: `packages/infra/test/club-night-stack.test.ts`

- [ ] **Step 1: Add failing assertions**

```ts
describe('Lambdas', () => {
  it('creates two Node 20 functions', () => {
    const t = synth();
    t.resourceCountIs('AWS::Lambda::Function', 2);
    t.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'handler',
    });
  });

  it('passes core env to the functions', () => {
    const t = synth();
    t.hasResourceProperties('AWS::Lambda::Function', {
      Environment: { Variables: Match.objectLike({ CLUB_NIGHT_TABLE: Match.anyValue(), COGNITO_USER_POOL_ID: Match.anyValue() }) },
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: FAIL — no Lambda functions.

- [ ] **Step 3: Add the Lambdas to the stack**

Add imports (note ESM `__dirname` derivation), the CfnParameters (used as env), and both functions:

```ts
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { CfnParameter, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
```

Inside the constructor, after Cognito:

```ts
    const dirname = path.dirname(fileURLToPath(import.meta.url));
    const apiEntry = path.join(dirname, '../../api/src/handler.ts');
    const scheduledEntry = path.join(dirname, '../../api/src/scheduled-handler.ts');

    const guestJwtSecret = new CfnParameter(this, 'GuestJwtSecret', {
      type: 'String',
      noEcho: true,
      minLength: 32,
      description: 'HS256 secret (>=32 chars) for guest-session JWTs',
    });
    const emailFrom = new CfnParameter(this, 'EmailFrom', {
      type: 'String',
      description: 'A verified SES sender address',
    });

    const appEnv: Record<string, string> = {
      CLUB_NIGHT_TABLE: table.tableName,
      GUEST_JWT_SECRET: guestJwtSecret.valueAsString,
      EMAIL_FROM: emailFrom.valueAsString,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
    };
    const bundling = { externalModules: ['@aws-sdk/*'] };
    const fnDefaults = {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler',
      timeout: Duration.seconds(30),
      bundling,
    };

    const scheduledFn = new NodejsFunction(this, 'ScheduledPairingFn', {
      ...fnDefaults,
      entry: scheduledEntry,
      environment: appEnv,
    });
    table.grantReadWriteData(scheduledFn);
    scheduledFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: ['*'] }),
    );
    this.scheduledFn = scheduledFn;

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      ...fnDefaults,
      entry: apiEntry,
      environment: appEnv, // scheduler env added in Task 5
    });
    table.grantReadWriteData(apiFn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: ['*'] }),
    );
    this.apiFn = apiFn;
```

Declare the fields:

```ts
  readonly scheduledFn: NodejsFunction;
  readonly apiFn: NodejsFunction;
```

> The API Lambda's scheduler env vars are added in Task 5 (once the scheduler group + role exist). Here it gets the core `appEnv` only — the `Match.objectLike` assertions don't require the scheduler vars yet.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: PASS (2 Lambda functions, env present). If synth tries to bundle despite the context flag and fails, confirm the test uses `new App({ context: { 'aws:cdk:bundling-stacks': [] } })`.

- [ ] **Step 5: Commit**

```bash
git add packages/infra/src/club-night-stack.ts packages/infra/test/club-night-stack.test.ts
git commit -m "feat(infra): add api + scheduled lambdas with table and SES access"
```

---

## Task 5: Function URL, EventBridge Scheduler group + role, scheduler IAM + env, outputs

**Files:**
- Modify: `packages/infra/src/club-night-stack.ts`
- Modify: `packages/infra/test/club-night-stack.test.ts`

- [ ] **Step 1: Add failing assertions**

```ts
describe('API URL, scheduler, and wiring', () => {
  it('exposes the API via a public Function URL', () => {
    const t = synth();
    t.resourceCountIs('AWS::Lambda::Url', 1);
    t.hasResourceProperties('AWS::Lambda::Url', { AuthType: 'NONE' });
  });

  it('creates an EventBridge Scheduler group', () => {
    const t = synth();
    t.resourceCountIs('AWS::Scheduler::ScheduleGroup', 1);
  });

  it('creates a role the scheduler service can assume', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Principal: { Service: 'scheduler.amazonaws.com' } }),
        ]),
      }),
    });
  });

  it('grants the API lambda permission to create/delete schedules', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: Match.arrayWith(['scheduler:CreateSchedule', 'scheduler:DeleteSchedule']) }),
        ]),
      }),
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts`
Expected: FAIL — no Function URL / scheduler group / scheduler role / scheduler policy.

- [ ] **Step 3: Add the URL, scheduler group + role, IAM, env, and outputs**

Add imports and constructor code (after the Lambdas):

```ts
import { CfnOutput, /* ...existing... */ } from 'aws-cdk-lib';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
```

```ts
    const SCHEDULE_GROUP_NAME = 'club-night';
    new scheduler.CfnScheduleGroup(this, 'ScheduleGroup', { name: SCHEDULE_GROUP_NAME });

    // Role the EventBridge Scheduler assumes to invoke the scheduled-pairing Lambda.
    const schedulerRole = new iam.Role(this, 'SchedulerInvokeRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    scheduledFn.grantInvoke(schedulerRole);

    // The API lambda needs the scheduler config + permission to create/delete schedules.
    apiFn.addEnvironment('SCHEDULER_GROUP', SCHEDULE_GROUP_NAME);
    apiFn.addEnvironment('SCHEDULER_TARGET_ARN', scheduledFn.functionArn);
    apiFn.addEnvironment('SCHEDULER_ROLE_ARN', schedulerRole.roleArn);
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['scheduler:CreateSchedule', 'scheduler:DeleteSchedule'],
        resources: [`arn:aws:scheduler:${this.region}:${this.account}:schedule/${SCHEDULE_GROUP_NAME}/*`],
      }),
    );
    apiFn.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['iam:PassRole'], resources: [schedulerRole.roleArn] }),
    );

    const fnUrl = apiFn.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new CfnOutput(this, 'ApiUrl', { value: fnUrl.url });
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, 'TableName', { value: table.tableName });
```

- [ ] **Step 4: Run it to verify it passes + typecheck**

Run: `npx vitest run packages/infra/test/club-night-stack.test.ts && npm run --workspace @club-night/infra typecheck`
Expected: PASS (all infra assertions); typecheck clean.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass. New this slice: infra synth 1 + table 2 + cognito 1 + lambdas 2 + url/scheduler 4 = **10**. Added to 208 → **218 total**. Typecheck clean for all three packages.

- [ ] **Step 6: Commit**

```bash
git add packages/infra/src/club-night-stack.ts packages/infra/test/club-night-stack.test.ts
git commit -m "feat(infra): add function url, scheduler group + role, IAM and outputs"
```

---

## Task 6: Deploy runbook

**Files:**
- Create: `packages/infra/DEPLOY.md`

- [ ] **Step 1: Write `packages/infra/DEPLOY.md`**

````markdown
# Deploying Club Night

The API + infrastructure deploy via AWS CDK (`packages/infra`). The frontend (slice 5)
is a static build deployed separately (S3/Netlify) pointed at the API URL.

## Prerequisites

- AWS account + credentials configured (`aws configure` / SSO).
- Node 20+, repo dependencies installed (`npm install` at the repo root).
- A verified **SES sender identity** (email or domain) in the target region — SES starts
  in sandbox mode (can only send to verified addresses); request production access for
  real use. Verify the address you'll pass as `EmailFrom`.
- A strong **guest JWT secret** (≥32 chars), e.g. `openssl rand -base64 48`.

## One-time bootstrap

```bash
cd packages/infra
npx cdk bootstrap aws://<ACCOUNT_ID>/<REGION>
```

## Deploy

```bash
cd packages/infra
npx cdk deploy ClubNightStack \
  --parameters GuestJwtSecret="<your-32+char-secret>" \
  --parameters EmailFrom="no-reply@yourdomain.example"
```

`NodejsFunction` bundles the API and scheduled-pairing handlers with esbuild (installed
as a dev dependency — no Docker needed). The deploy prints outputs:

- `ApiUrl` — the Lambda Function URL; configure the frontend to call this.
- `UserPoolId`, `UserPoolClientId` — for organizer sign-in.
- `TableName` — the DynamoDB table.

## Post-deploy: provision a club + organizer

Clubs are provisioned manually (no self-service UI in the MVP). Follow the
**Club provisioning runbook** in
`docs/superpowers/specs/2026-06-11-club-night-design.md`, using the deployed `TableName`
and `UserPoolId`:

1. Create the organizer's Cognito user in the pool (`aws cognito-idp admin-create-user`).
2. Put the Club item and the OWNER Membership item into the table (per the runbook).
3. Log in as the organizer and create a game night.

## How auto-pairing fires

Creating a night calls `scheduler:CreateSchedule` to register a one-shot EventBridge
schedule at the night's `signupDeadline`, targeting the scheduled-pairing Lambda (via the
`SchedulerInvokeRole`). At the deadline it runs `runDeadlinePairing` (generate + close +
notify the organizer); the organizer then resolves any odd-one-out and publishes.

## Teardown

```bash
npx cdk destroy ClubNightStack
```

The DynamoDB table and Cognito user pool use `RETAIN` removal policy, so they survive a
stack delete (delete them manually if you truly want the data gone).
````

- [ ] **Step 2: Verify the doc renders / no broken references**

Run: `ls packages/infra/DEPLOY.md`
Expected: file exists. (Cross-check that the env var names and the provisioning-runbook reference match the spec.)

- [ ] **Step 3: Commit**

```bash
git add packages/infra/DEPLOY.md
git commit -m "docs(infra): add deploy runbook"
```

---

## Done criteria

- `npm test` passes (~218 tests, including the new infra synth assertions) and `npm run typecheck` is clean for all three packages.
- `ClubNightStack` synthesizes a template with: one PAY_PER_REQUEST DynamoDB table (TTL on `ttl`, 3 GSIs), a Cognito user pool + client, two Node 20 Lambdas (API + scheduled) with the correct env, a public Function URL, an EventBridge Scheduler group, a scheduler-assumable IAM role, and the API Lambda's `scheduler:CreateSchedule`/`DeleteSchedule` + `iam:PassRole` permissions.
- The API Lambda env carries `SCHEDULER_GROUP`/`SCHEDULER_TARGET_ARN`/`SCHEDULER_ROLE_ARN`; the scheduled Lambda does not.
- `DEPLOY.md` documents bootstrap, the parameterized `cdk deploy`, SES verification, and the post-deploy club-provisioning steps.
- The stack is deployable by the owner with `cdk deploy` (run with their AWS credentials) — this plan delivers the synthesizable, unit-tested CDK code, not a live deployment.
- Remaining: slice 5 (Vite + React static frontend).
