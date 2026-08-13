import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/store/db.ts";
import { redactEnv, redactString, sanitizeError } from "../../src/util/redaction.ts";
import {
  acquireWorkerLock,
  isWorkerHealthy,
  releaseWorkerLock,
  writeHeartbeat,
} from "../../src/worker/lock.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempEnv(): { config: string; state: string } {
  const root = mkdtempSync(join(tmpdir(), "herdr-auto-"));
  dirs.push(root);
  const config = join(root, "config");
  const state = join(root, "state");
  process.env.HERDR_PLUGIN_CONFIG_DIR = config;
  process.env.HERDR_PLUGIN_STATE_DIR = state;
  return { config, state };
}

describe("store migrations/claims", () => {
  test("migrates and claims occurrences once", () => {
    tempEnv();
    const store = new Store();
    const first = store.tryClaimOccurrence({
      occurrenceKey: "cron:demo:1",
      automationId: "demo",
      runId: "run-1",
      claimedAt: Date.now(),
    });
    const second = store.tryClaimOccurrence({
      occurrenceKey: "cron:demo:1",
      automationId: "demo",
      runId: "run-2",
      claimedAt: Date.now(),
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(store.markAbandonedRunsInterrupted()).toBe(0);
    store.insertRun({
      id: "run-active",
      automation_id: "demo",
      occurrence_key: "manual:1",
      trigger_kind: "manual",
      status: "running",
      started_at: Date.now(),
      finished_at: null,
      summary: null,
      error: null,
      manual: 1,
      created_at: Date.now(),
    });
    expect(store.markAbandonedRunsInterrupted()).toBe(1);
    expect(store.getRun("run-active")?.status).toBe("interrupted_unknown");
    store.close();
  });
});

describe("locks", () => {
  test("acquire/release singleton lock", () => {
    const { state } = tempEnv();
    mkdirSync(state, { recursive: true });
    const lock = acquireWorkerLock();
    // Readiness requires heartbeat + control sock (not lock alone).
    expect(isWorkerHealthy()).toBe(false);
    writeHeartbeat();
    writeFileSync(join(state, "control.sock"), "");
    expect(isWorkerHealthy()).toBe(true);
    expect(() => acquireWorkerLock()).toThrow(/already running/);
    releaseWorkerLock(lock);
    expect(isWorkerHealthy()).toBe(false);
  });

  test("recovers stale lock", () => {
    const { state } = tempEnv();
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "worker.pid"), "99999999\n");
    writeFileSync(join(state, "worker.lock"), "99999999\n");
    writeFileSync(join(state, "worker.heartbeat"), `${Date.now() - 60_000}\n`);
    const lock = acquireWorkerLock();
    expect(lock.pid).toBe(process.pid);
    releaseWorkerLock(lock);
  });
});

describe("redaction", () => {
  test("redacts secret-like values and env keys", () => {
    expect(redactString("token ghp_abcdefghijklmnopqrstuv")).toContain("[REDACTED]");
    expect(redactEnv({ API_KEY: "abc", PATH: "/usr/bin" })).toEqual({
      API_KEY: "[REDACTED]",
      PATH: "/usr/bin",
    });
    expect(sanitizeError(new Error("Bearer supersecretvalue123"))).toContain("[REDACTED]");
  });
});
