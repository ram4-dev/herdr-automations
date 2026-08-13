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
  const root = mkdtempSync(join(tmpdir(), "herdr-sched-"));
  dirs.push(root);
  process.env.HERDR_PLUGIN_CONFIG_DIR = join(root, "config");
  process.env.HERDR_PLUGIN_STATE_DIR = join(root, "state");
  return new Store();
}

const noopExecutor = async () => ({
  status: "succeeded" as const,
  exitCode: 0,
  summary: "status=succeeded",
  error: null,
});

const defaults = {
  timezone: DEFAULT_TIMEZONE,
  overlap: "skip" as const,
  catch_up: "latest" as const,
  timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
};

function cronAutomation(id: string, expr = "0 9 * * *"): ReturnType<typeof resolveAutomation> {
  const raw: AutomationConfig = {
    id,
    enabled: true,
    cwd: "/tmp",
    overlap: "skip",
    catch_up: "latest",
    trigger: { type: "cron", expr, timezone: DEFAULT_TIMEZONE },
    action: { type: "command", command: ["true"], env: {} },
  };
  return resolveAutomation(raw, defaults);
}

describe("scheduler catch-up/dedupe/overlap", () => {
  test("claims cron occurrence only once", async () => {
    const store = setupStore();
    const scheduler = new Scheduler(store, noopExecutor);
    const automation = resolveAutomation(
      {
        id: "evt",
        enabled: true,
        cwd: "/tmp",
        overlap: "skip",
        catch_up: "latest",
        trigger: {
          type: "event",
          event: "pane.agent_status_changed",
          match: { agent_status: "done" },
        },
        action: { type: "command", command: ["true"], env: {} },
      },
      defaults,
    );
    scheduler.setAutomations([automation]);

    const payload = {
      type: "pane.agent_status_changed",
      id: "evt-1",
      data: { agent_status: "done", pane_id: "w1:p1" },
    };
    scheduler.handleEvent("pane.agent_status_changed", payload);
    scheduler.handleEvent("pane.agent_status_changed", payload);
    await scheduler.drain();
    const runs = store.listRuns("evt", 10);
    expect(runs.length).toBe(1);
    scheduler.stop();
    store.close();
  });

  test("overlap skip records skipped_overlap when active", async () => {
    const store = setupStore();
    const scheduler = new Scheduler(store, noopExecutor);
    const automation = cronAutomation("busy");
    scheduler.setAutomations([automation]);
    store.insertRun({
      id: "active",
      automation_id: "busy",
      occurrence_key: "manual:active",
      trigger_kind: "manual",
      status: "running",
      started_at: Date.now(),
      finished_at: null,
      summary: null,
      error: null,
      manual: 1,
      created_at: Date.now(),
    });
    // Force an event automation for deterministic claim without waiting cron.
    const eventAuto = resolveAutomation(
      {
        id: "busy",
        enabled: true,
        cwd: "/tmp",
        overlap: "skip",
        catch_up: "latest",
        trigger: {
          type: "event",
          event: "pane.closed",
          match: {},
        },
        action: { type: "command", command: ["true"], env: {} },
      },
      defaults,
    );
    scheduler.setAutomations([eventAuto]);
    scheduler.handleEvent("pane.closed", {
      type: "pane.closed",
      id: "c1",
      data: { pane_id: "w1:p2" },
    });
    await scheduler.drain();
    const runs = store.listRuns("busy", 10);
    expect(runs.some((run) => run.status === "skipped_overlap")).toBe(true);
    scheduler.stop();
    store.close();
  });

  test("first-seen cron arms schedule without executing catch-up", async () => {
    const store = setupStore();
    const scheduler = new Scheduler(store, noopExecutor);
    const automation = cronAutomation("catch", "* * * * *");
    scheduler.setAutomations([automation]);
    await scheduler.drain();
    scheduler.stop();
    const state = store.getAutomationState("catch");
    expect(store.listRuns("catch", 50)).toHaveLength(0);
    expect(state?.schedule_initialized_at).not.toBeNull();
    expect(state?.next_run_at).not.toBeNull();
    store.close();
  });
});
