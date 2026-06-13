import type { Scheduler } from './scheduler';
import { EventBridgeScheduler } from './eventbridge-scheduler';

let scheduler: Scheduler | undefined;

export function getScheduler(): Scheduler {
  if (!scheduler) scheduler = new EventBridgeScheduler();
  return scheduler;
}

/** Override the scheduler (used by tests). Pass undefined to reset to the default. */
export function setScheduler(next: Scheduler | undefined): void {
  scheduler = next;
}
