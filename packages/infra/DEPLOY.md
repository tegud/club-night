# Deploying Club Night

The API + infrastructure deploy via AWS CDK (`packages/infra`), which also provisions
S3 + CloudFront hosting for the static frontend. A push to `main` deploys everything
automatically via GitHub Actions (`.github/workflows/deploy.yml`); the manual steps below
are the same flow run by hand.

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

- `ApiUrl` — the Lambda Function URL; the frontend build is wired to this (`VITE_API_URL`).
- `UserPoolId`, `UserPoolClientId` — for organizer sign-in (`VITE_COGNITO_*`).
- `TableName` — the DynamoDB table.
- `SiteBucketName` — the private S3 bucket the frontend is synced into.
- `DistributionId` — the CloudFront distribution to invalidate after a sync.
- `SiteUrl` — the public CloudFront URL the site is served from.

### Frontend (manual)

```bash
cd packages/frontend
VITE_API_URL="<ApiUrl>" \
VITE_COGNITO_USER_POOL_ID="<UserPoolId>" \
VITE_COGNITO_CLIENT_ID="<UserPoolClientId>" \
  npm run build
aws s3 sync dist/ "s3://<SiteBucketName>/" --delete
aws cloudfront create-invalidation --distribution-id "<DistributionId>" --paths "/*"
```

## CI/CD: deploy on push to `main`

`.github/workflows/deploy.yml` runs typecheck + the full test suite, then `cdk deploy`,
then builds the frontend (wired to the stack outputs) and syncs it to S3 + invalidates
CloudFront. It still requires a **one-time `cdk bootstrap`** (above) in the target account.

Configure these in the repo's **production** GitHub Environment (Settings → Environments):

| Secret | Value |
| --- | --- |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials for a principal that can assume the CDK bootstrap roles and run `s3 sync` + `cloudfront create-invalidation`. |
| `GUEST_JWT_SECRET` | The ≥32-char guest-session signing secret. **Keep it stable** — changing it invalidates all existing guest sessions. |
| `EMAIL_FROM` | The verified SES sender address. |

The region is set in the workflow `env` (`eu-west-2`); change it there if you deploy elsewhere.

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

The DynamoDB table, Cognito user pool, and the frontend S3 bucket use `RETAIN` removal
policy, so they survive a stack delete (empty + delete them manually if you truly want
the data gone — a `RETAIN`ed bucket must be emptied before it can be deleted).
