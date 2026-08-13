import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAutomation, type AutomationConfig } from "../../src/config/schema.ts";
import { DEFAULT_TIMEOUT_SECONDS, DEFAULT_TIMEZONE } from "../../src/constants.ts";
import { Store } from "../../src/store/db.ts";
import { Scheduler } from "../../src/worker/scheduler.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setupStore(): Store {
  const root = mkdtempSync(join(tmpdir(), "herdr-intv-"));
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

describe("interval first-seen arming", () => {
  test("fake clock: arms baseline and fires exactly once after the first interval", async () => {
    const store = setupStore();
    let now = 1_000_000;
    const clock = () => now;
    let executions = 0;
    const scheduler = new Scheduler(
      store,
      async () => {
        executions += 1;
        return {
          status: "succeeded",
          exitCode: 0,
          summary: "status=succeeded",
          error: null,
        };
      },
      clock,
    );

    const raw: AutomationConfig = {
      id: "pulse",
      enabled: true,
      cwd: "/tmp",
      overlap: "skip",
      catch_up: "latest",
      trigger: { type: "interval", every: "10s" },
      action: { type: "command", command: ["true"], env: {} },
    };
    scheduler.setAutomations([resolveAutomation(raw, defaults)]);
    await scheduler.drain();

    const armed = store.getAutomationState("pulse");
    expect(armed?.schedule_initialized_at).toBe(1_000_000);
    expect(armed?.last_claimed_occurrence_ms).toBe(1_000_000);
    expect(armed?.next_run_at).toBe(1_010_000);
    expect(executions).toBe(0);
    expect(store.listRuns("pulse", 10)).toHaveLength(0);

    // Mid-interval ticks must not slide the deadline or fire.
    now = 1_005_000;
    scheduler.tick(now);
    await scheduler.drain();
    expect(executions).toBe(0);
    expect(store.getAutomationState("pulse")?.next_run_at).toBe(1_010_000);

    now = 1_009_999;
    scheduler.tick(now);
    await scheduler.drain();
    expect(executions).toBe(0);

    now = 1_010_000;
    scheduler.tick(now);
    await scheduler.drain();
    expect(executions).toBe(1);
    expect(store.listRuns("pulse", 10)).toHaveLength(1);

    // Same deadline again must not double-fire.
    scheduler.tick(now);
    await scheduler.drain();
    expect(executions).toBe(1);

    // Next interval only.
    now = 1_020_000;
    scheduler.tick(now);
    await scheduler.drain();
    expect(executions).toBe(2);

    scheduler.stop();
    store.close();
  });
});
