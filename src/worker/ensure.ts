import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pluginRoot } from "../util/paths.ts";
import { sleep } from "../util/time.ts";
import { clearStaleLockArtifacts, isWorkerHealthy, readWorkerPid } from "./lock.ts";

const POLL_MS = 50;
const MAX_WAIT_MS = 3_000;

export async function ensureWorker(): Promise<{ started: boolean; pid: number | null }> {
  clearStaleLockArtifacts();
  if (isWorkerHealthy()) {
    return { started: false, pid: readWorkerPid() };
  }

  const root = pluginRoot();
  const entry = join(root, "src/main.ts");
  if (!existsSync(entry)) {
    throw new Error(`plugin entry not found: ${entry}`);
  }

  const child = spawn("bun", ["run", entry, "worker"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (isWorkerHealthy()) {
      return { started: true, pid: readWorkerPid() };
    }
  }

  throw new Error(
    `worker failed to become ready within ${MAX_WAIT_MS}ms (spawn pid=${child.pid ?? "?"})`,
  );
}
