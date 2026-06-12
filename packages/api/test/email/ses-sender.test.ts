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
