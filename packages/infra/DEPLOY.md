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
