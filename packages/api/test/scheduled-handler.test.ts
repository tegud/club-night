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
