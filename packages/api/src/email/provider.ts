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
