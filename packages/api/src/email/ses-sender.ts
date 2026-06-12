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
