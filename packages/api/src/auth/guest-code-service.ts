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
