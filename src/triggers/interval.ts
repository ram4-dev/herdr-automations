import { parseDurationToMs } from "../util/time.ts";

export function intervalMs(every: string): number {
  return parseDurationToMs(every);
}

export function nextIntervalRunMs(
  every: string,
  lastRunMs: number | null,
  now = Date.now(),
): number {
  const step = intervalMs(every);
  // No prior claim: schedule one full interval ahead (do not invent a missed run).
  if (lastRunMs === null) return now + step;
  const elapsed = now - lastRunMs;
  if (elapsed >= step) return now;
  return lastRunMs + step;
}

export function latestMissedIntervalOccurrenceMs(
  every: string,
  lastClaimedMs: number | null,
  now = Date.now(),
): number | null {
  const step = intervalMs(every);
  if (lastClaimedMs === null) {
    // First start: do not invent a historical miss; wait for the first tick.
    return null;
  }
  if (now - lastClaimedMs < step) return null;
  const missedCount = Math.floor((now - lastClaimedMs) / step);
  return lastClaimedMs + missedCount * step;
}

export function intervalOccurrenceKey(automationId: string, occurrenceMs: number): string {
  return `interval:${automationId}:${occurrenceMs}`;
}
