import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireWorkerLock, releaseWorkerLock } from "../../src/worker/lock.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("worker lock exclusivity", () => {
  test("concurrent acquireWorkerLock yields exactly one winner", async () => {
    const root = mkdtempSync(join(tmpdir(), "herdr-lock-"));
    dirs.push(root);
    const state = join(root, "state");
    mkdirSync(state, { recursive: true });
    process.env.HERDR_PLUGIN_STATE_DIR = state;
    process.env.HERDR_PLUGIN_CONFIG_DIR = join(root, "config");
    mkdirSync(join(root, "config"), { recursive: true });

    const results = await Promise.allSettled(
      Array.from({ length: 8 }, async () => acquireWorkerLock()),
    );
    const wins = results.filter((result) => result.status === "fulfilled");
    const losses = results.filter((result) => result.status === "rejected");
    expect(wins).toHaveLength(1);
    expect(losses.length).toBe(7);
    if (wins[0]?.status === "fulfilled") {
      releaseWorkerLock(wins[0].value);
    }
  });
});
