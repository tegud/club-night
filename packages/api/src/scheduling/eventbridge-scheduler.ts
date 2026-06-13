import {
  SchedulerClient,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-scheduler';
import type { Scheduler, ScheduledPairingEvent } from './scheduler';

export interface SchedulerConfig {
  groupName: string;
  targetArn: string;
  roleArn: string;
}

function loadSchedulerConfig(): SchedulerConfig {
  const targetArn = process.env.SCHEDULER_TARGET_ARN;
  const roleArn = process.env.SCHEDULER_ROLE_ARN;
  if (!targetArn) throw new Error('SCHEDULER_TARGET_ARN is not configured');
  if (!roleArn) throw new Error('SCHEDULER_ROLE_ARN is not configured');
  return {
    groupName: process.env.SCHEDULER_GROUP ?? 'club-night',
    targetArn,
    roleArn,
  };
}

function scheduleName(nightId: string): string {
  return `clubnight-${nightId}`;
}

export class EventBridgeScheduler implements Scheduler {
  constructor(
    private readonly client: SchedulerClient = new SchedulerClient({}),
    private readonly config: SchedulerConfig = loadSchedulerConfig(),
  ) {}

  async createNightSchedule(clubId: string, nightId: string, runAtIso: string): Promise<void> {
    await this.client.send(
      new CreateScheduleCommand({
        Name: scheduleName(nightId),
        GroupName: this.config.groupName,
        ScheduleExpression: `at(${new Date(runAtIso).toISOString().slice(0, 19)})`, // normalize to UTC `yyyy-mm-ddThh:mm:ss`
        ScheduleExpressionTimezone: 'UTC',
        FlexibleTimeWindow: { Mode: 'OFF' },
        ActionAfterCompletion: 'DELETE', // auto-remove the one-shot after it fires
        Target: {
          Arn: this.config.targetArn,
          RoleArn: this.config.roleArn,
          Input: JSON.stringify({ clubId, nightId } satisfies ScheduledPairingEvent),
        },
      }),
    );
  }

  async deleteNightSchedule(_clubId: string, nightId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteScheduleCommand({ Name: scheduleName(nightId), GroupName: this.config.groupName }),
      );
    } catch (err) {
      if (!(err instanceof ResourceNotFoundException)) throw err;
    }
  }
}
