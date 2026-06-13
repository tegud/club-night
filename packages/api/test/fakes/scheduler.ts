import type { Scheduler } from '../../src/scheduling/scheduler';

export class FakeScheduler implements Scheduler {
  readonly created: { clubId: string; nightId: string; runAtIso: string }[] = [];
  readonly deleted: { clubId: string; nightId: string }[] = [];

  async createNightSchedule(clubId: string, nightId: string, runAtIso: string): Promise<void> {
    this.created.push({ clubId, nightId, runAtIso });
  }

  async deleteNightSchedule(clubId: string, nightId: string): Promise<void> {
    this.deleted.push({ clubId, nightId });
  }
}
