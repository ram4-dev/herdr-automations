import { describe, expect, test } from "bun:test";
import {
  latestDueCronOccurrenceMs,
  nextCronRunMs,
  previousCronRunMs,
} from "../../src/triggers/cron.ts";
import { eventMatches } from "../../src/triggers/events.ts";
import {
  intervalMs,
  latestMissedIntervalOccurrenceMs,
  nextIntervalRunMs,
} from "../../src/triggers/interval.ts";

describe("cron/timezone", () => {
  test("parses five-field cron and returns future next run", () => {
    const next = nextCronRunMs(
      "0 9 * * 1-5",
      "America/Argentina/Buenos_Aires",
      Date.parse("2026-08-12T12:00:00-03:00"),
    );
    expect(next).not.toBeNull();
    expect(next! > Date.parse("2026-08-12T12:00:00-03:00")).toBe(true);
  });

  test("previous/latest due stay stable around DST-safe zone", () => {
    // America/Argentina/Buenos_Aires has no DST currently; still validates timezone path.
    const from = Date.parse("2026-08-12T10:00:00-03:00");
    const prev = previousCronRunMs("0 9 * * *", "America/Argentina/Buenos_Aires", from);
    const latest = latestDueCronOccurrenceMs("0 9 * * *", "America/Argentina/Buenos_Aires", from);
    expect(prev).toBe(latest);
    expect(prev).toBe(Date.parse("2026-08-12T09:00:00-03:00"));
  });

  test("rejects invalid timezone", () => {
    expect(() => nextCronRunMs("0 9 * * *", "Not/AZone")).toThrow(/timezone/i);
  });
});

describe("interval", () => {
  test("parses s/m/h", () => {
    expect(intervalMs("30s")).toBe(30_000);
    expect(intervalMs("5m")).toBe(300_000);
    expect(intervalMs("2h")).toBe(7_200_000);
  });

  test("first schedule waits one full interval", () => {
    const now = 1_000_000;
    expect(nextIntervalRunMs("10m", null, now)).toBe(now + 600_000);
  });

  test("catch-up returns only latest missed occurrence", () => {
    const every = "10m";
    const last = 0;
    const now = 35 * 60_000;
    const missed = latestMissedIntervalOccurrenceMs(every, last, now);
    expect(missed).toBe(30 * 60_000);
  });
});

describe("event filters", () => {
  test("equality match uses normalized data payload fields", () => {
    const payload = {
      type: "pane.agent_status_changed",
      data: { agent_status: "blocked", pane_id: "w1:p1" },
    };
    expect(eventMatches({ agent_status: "blocked" }, payload)).toBe(true);
    expect(eventMatches({ "data.agent_status": "blocked" }, payload)).toBe(true);
    expect(eventMatches({ agent_status: "done" }, payload)).toBe(false);
    expect(eventMatches({ missing: "x" }, payload)).toBe(false);
  });
});
