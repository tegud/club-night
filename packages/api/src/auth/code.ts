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
