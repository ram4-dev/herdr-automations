import { Cron } from "croner";

export function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone "${timezone}"`);
  }
}

export function createCron(expr: string, timezone: string): Cron {
  assertValidTimezone(timezone);
  return new Cron(expr, {
    timezone,
    catch: false,
    legacyMode: false,
  });
}

export function nextCronRunMs(expr: string, timezone: string, fromMs = Date.now()): number | null {
  const cron = createCron(expr, timezone);
  const next = cron.nextRun(new Date(fromMs));
  return next ? next.getTime() : null;
}

export function previousCronRunMs(
  expr: string,
  timezone: string,
  fromMs = Date.now(),
): number | null {
  const cron = createCron(expr, timezone);
  // croner@10: previousRun(date) is unreliable; previousRuns(n, date) is stable.
  const previous = cron.previousRuns(1, new Date(fromMs))[0];
  return previous ? previous.getTime() : null;
}

/** Latest scheduled occurrence at or before `fromMs`. */
export function latestDueCronOccurrenceMs(
  expr: string,
  timezone: string,
  fromMs = Date.now(),
): number | null {
  const previous = previousCronRunMs(expr, timezone, fromMs + 1);
  return previous;
}

export function cronOccurrenceKey(automationId: string, occurrenceMs: number): string {
  return `cron:${automationId}:${occurrenceMs}`;
}
