import { assertAppConfig } from './config/app-config';
import { runDeadlinePairing } from './services/pairing-service';
import type { ScheduledPairingEvent } from './scheduling/scheduler';

assertAppConfig();

/** Invoked by EventBridge Scheduler at a night's signupDeadline. */
export async function handler(event: ScheduledPairingEvent): Promise<void> {
  await runDeadlinePairing(event.clubId, event.nightId);
}
