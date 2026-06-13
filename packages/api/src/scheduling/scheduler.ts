export interface Scheduler {
  /** Create a one-shot schedule that fires at `runAtIso` (ISO 8601) to auto-pair the night. */
  createNightSchedule(clubId: string, nightId: string, runAtIso: string): Promise<void>;
  /** Delete a night's schedule (e.g. on cancellation). `clubId` is reserved for symmetry — schedule names are nightId-scoped. No-op if it doesn't exist. */
  deleteNightSchedule(clubId: string, nightId: string): Promise<void>;
}

export interface ScheduledPairingEvent {
  clubId: string;
  nightId: string;
}
