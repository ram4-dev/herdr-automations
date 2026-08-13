import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAutomation, type AutomationConfig } from "../../src/config/schema.ts";
import {
  DEFAULT_TIMEOUT_SECONDS,
  DEFAULT_TIMEZONE,
  GLOBAL_CONCURRENCY,
} from "../../src/constants.ts";
import { Store } from "../../src/store/db.ts";
import { Scheduler } from "../../src/worker/scheduler.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setupStore(): Store {
  const root = mkdtempSync(join(tmpdir(), "herdr-cancel-"));
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

function eventAutomation(id: string): ReturnType<typeof resolveAutomation> {
  const raw: AutomationConfig = {
    id,
    enabled: true,
    cwd: "/tmp",
    overlap: "skip",
    catch_up: "latest",
    trigger: { type: "event", event: "pane.closed", match: {} },
    action: { type: "command", command: ["true"], env: {} },
  };
  return resolveAutomation(raw, defaults);
}

describe("queued run cancellation", () => {
  test("cancels latest queued run durably and refuses executing runs", async () => {
    const store = setupStore();
    const releases: Array<() => void> = [];
    const waiters: Promise<void>[] = [];
    const block = () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      });

    const scheduler = new Scheduler(store, async () => {
      waiters.push(block());
      await waiters[waiters.length - 1];
      return {
        status: "succeeded",
        exitCode: 0,
        summary: "status=succeeded",
        error: null,
      };
    });

    // Fill global concurrency with other automations so target stays queued.
    const fillers = Array.from({ length: GLOBAL_CONCURRENCY }, (_, i) =>
      eventAutomation(`filler-${i}`),
    );
    const target = eventAutomation("target");
    scheduler.setAutomations([...fillers, target]);

    for (const filler of fillers) {
      const result = await scheduler.runNow(filler.id);
      expect("runId" in result).toBe(true);
    }
    // Let fillers enter running state.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(releases.length).toBe(GLOBAL_CONCURRENCY);

    const queued = await scheduler.runNow("target");
    expect("runId" in queued).toBe(true);
    if ("error" in queued) throw new Error(queued.error);
    expect(store.getRun(queued.runId)?.status).toBe("queued");

    const cancelled = scheduler.cancel("target");
    expect("runId" in cancelled).toBe(true);
    if ("error" in cancelled) throw new Error(cancelled.error);
    expect(cancelled.runId).toBe(queued.runId);
    expect(store.getRun(queued.runId)?.status).toBe("cancelled");
    expect(store.getAutomationState("target")?.last_status).toBe("cancelled");

    // Executing filler cannot be cancelled safely.
    const busy = scheduler.cancel("filler-0");
    expect("error" in busy).toBe(true);
    if ("error" in busy) {
      expect(busy.error).toMatch(/already executing|cannot be cancelled/i);
    }

    for (const release of releases) release();
    await scheduler.drain();
    expect(store.getRun(queued.runId)?.status).toBe("cancelled");

    scheduler.stop();
    store.close();
  });

  test("cancel with nothing queued returns a clear error", async () => {
    const store = setupStore();
    const scheduler = new Scheduler(store, async () => ({
      status: "succeeded",
      exitCode: 0,
      summary: "status=succeeded",
      error: null,
    }));
    scheduler.setAutomations([eventAutomation("idle")]);
    const result = scheduler.cancel("idle");
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/no queued run/i);
    scheduler.stop();
    store.close();
  });
});
