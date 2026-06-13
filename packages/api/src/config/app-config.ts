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

const REQUIRED_SCHEDULER_ENV = ['SCHEDULER_TARGET_ARN', 'SCHEDULER_ROLE_ARN'] as const;

/** Fail fast if the API Lambda (which creates night schedules) is missing scheduler config. */
export function assertSchedulerConfig(env: Record<string, string | undefined> = process.env): void {
  const missing = REQUIRED_SCHEDULER_ENV.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required scheduler environment variables: ${missing.join(', ')}`);
  }
}
