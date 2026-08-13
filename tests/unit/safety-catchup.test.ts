import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exampleConfigYaml, loadConfigFromText } from "../../src/config/load.ts";
import { resolveAutomation, type AutomationConfig } from "../../src/config/schema.ts";
import { DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEZONE } from "../../src/constants.ts";
import { Store } from "../../src/store/db.ts";
import { latestDueCronOccurrenceMs } from "../../src/triggers/cron.ts";
import { Scheduler } from "../../src/worker/scheduler.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setupStore(): Store {
  const root = mkdtempSync(join(tmpdir(), "herdr-safe-"));
  dirs.push(root);
  process.env.HERDR_PLUGIN_CONFIG_DIR = join(root, "config");
  process.env.HERDR_PLUGIN_STATE_DIR = join(root, "state");
  return new Store();
}

const defaults = {
  timezone: DEFAULT_TIMEZONE,
  overlap: "skip" as const,
  catch_up: "latest" as const,
  timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
};

const noopExecutor = async () => ({
  status: "succeeded" as const,
  exitCode: 0,
  summary: "status=succeeded",
  error: null,
});

describe("fresh install safety", () => {
  test("seeded example YAML has every automation disabled", () => {
    const loaded = loadConfigFromText(exampleConfigYaml());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.automations.length).toBeGreaterThan(0);
    expect(loaded.automations.every((item) => item.enabled === false)).toBe(true);
  });

  test("fresh install with enabled cron executes nothing and only schedules future", async () => {
    const store = setupStore();
    let executions = 0;
    const scheduler = new Scheduler(store, async () => {
      executions += 1;
      return noopExecutor();
    });
    const raw: AutomationConfig = {
      id: "morning",
      enabled: true,
      cwd: "/tmp",
      overlap: "skip",
      catch_up: "latest",
      trigger: {
        type: "cron",
        expr: "0 9 * * *",
        timezone: DEFAULT_TIMEZONE,
      },
      action: { type: "command", command: ["true"], env: {} },
    };
    scheduler.setAutomations([resolveAutomation(raw, defaults)]);
    await scheduler.drain();
    scheduler.tick(Date.now());
    await scheduler.drain();

    expect(executions).toBe(0);
    expect(store.listRuns("morning", 20)).toHaveLength(0);
    const state = store.getAutomationState("morning");
    expect(state?.schedule_initialized_at).not.toBeNull();
    expect(state?.next_run_at).not.toBeNull();
    expect(state!.next_run_at!).toBeGreaterThan(Date.now() - 1_000);
    const due = latestDueCronOccurrenceMs("0 9 * * *", DEFAULT_TIMEZONE);
    expect(state?.last_claimed_occurrence_ms).toBe(due);
    scheduler.stop();
    store.close();
  });

  test("restart catch-up recovers at most one missed occurrence when previously armed", async () => {
    const store = setupStore();
    let executions = 0;
    const raw: AutomationConfig = {
      id: "morning",
      enabled: true,
      cwd: "/tmp",
      overlap: "skip",
      catch_up: "latest",
      trigger: {
        type: "cron",
        expr: "0 9 * * *",
        timezone: DEFAULT_TIMEZONE,
      },
      action: { type: "command", command: ["true"], env: {} },
    };
    const automation = resolveAutomation(raw, defaults);

    const first = new Scheduler(store, async () => {
      executions += 1;
      return noopExecutor();
    });
    first.setAutomations([automation]);
    await first.drain();
    expect(executions).toBe(0);
    // Simulate a previously claimed older occurrence (worker was running yesterday).
    const oldClaim = Date.parse("2026-08-10T09:00:00-03:00");
    store.setLastClaimedOccurrenceMs("morning", oldClaim);
    first.stop();

    const second = new Scheduler(store, async () => {
      executions += 1;
      return noopExecutor();
    });
    second.setAutomations([automation]);
    await second.drain();
    expect(executions).toBe(1);
    expect(store.listRuns("morning", 20)).toHaveLength(1);
    second.stop();
    store.close();
  });
});
