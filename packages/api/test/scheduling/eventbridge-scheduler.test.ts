import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceNotFoundException } from '@aws-sdk/client-scheduler';
import { EventBridgeScheduler } from '../../src/scheduling/eventbridge-scheduler';

const config = { groupName: 'club-night', targetArn: 'arn:lambda:pairer', roleArn: 'arn:role:sched' };

describe('EventBridgeScheduler', () => {
  let sent: { input: unknown }[];
  let stubClient: { send: (command: { input: unknown }) => Promise<unknown> };

  beforeEach(() => {
    sent = [];
    stubClient = { send: async (command) => { sent.push(command); return {}; } };
  });

  it('creates a one-shot UTC schedule targeting the pairing lambda with the night payload', async () => {
    const scheduler = new EventBridgeScheduler(stubClient as never, config);
    await scheduler.createNightSchedule('club-1', 'night-1', '2026-07-02T12:00:00.000Z');
    expect(sent).toHaveLength(1);
    const input = sent[0]!.input as {
      Name: string; GroupName: string; ScheduleExpression: string; ScheduleExpressionTimezone: string;
      FlexibleTimeWindow: { Mode: string }; ActionAfterCompletion: string;
      Target: { Arn: string; RoleArn: string; Input: string };
    };
    expect(input.Name).toBe('clubnight-night-1');
    expect(input.GroupName).toBe('club-night');
    expect(input.ScheduleExpression).toBe('at(2026-07-02T12:00:00)');
    expect(input.ScheduleExpressionTimezone).toBe('UTC');
    expect(input.FlexibleTimeWindow.Mode).toBe('OFF');
    expect(input.ActionAfterCompletion).toBe('DELETE');
    expect(input.Target.Arn).toBe('arn:lambda:pairer');
    expect(input.Target.RoleArn).toBe('arn:role:sched');
    expect(JSON.parse(input.Target.Input)).toEqual({ clubId: 'club-1', nightId: 'night-1' });
  });

  it('deletes a schedule by name and group', async () => {
    const scheduler = new EventBridgeScheduler(stubClient as never, config);
    await scheduler.deleteNightSchedule('club-1', 'night-1');
    expect(sent).toHaveLength(1);
    expect((sent[0]!.input as { Name: string }).Name).toBe('clubnight-night-1');
    expect((sent[0]!.input as { GroupName: string }).GroupName).toBe('club-night');
  });

  it('swallows ResourceNotFoundException when deleting a missing schedule', async () => {
    const throwingClient = { send: async () => { throw new ResourceNotFoundException({ message: 'gone', Message: 'gone', $metadata: {} }); } };
    const scheduler = new EventBridgeScheduler(throwingClient as never, config);
    await expect(scheduler.deleteNightSchedule('club-1', 'night-1')).resolves.toBeUndefined();
  });
});
