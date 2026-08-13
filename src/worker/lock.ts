import {
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { STALE_HEARTBEAT_MS } from "../constants.ts";
import { atomicWriteText } from "../util/atomic.ts";
import { controlSockPath, heartbeatPath, workerLockPath, workerPidPath } from "../util/paths.ts";

export type LockHandle = {
  path: string;
  pid: number;
  fd: number;
};

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readWorkerPid(): number | null {
  try {
    const raw = readFileSync(workerPidPath(), "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

export function readHeartbeatMs(): number | null {
  try {
    const raw = readFileSync(heartbeatPath(), "utf8").trim();
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeHeartbeat(now = Date.now()): void {
  atomicWriteText(heartbeatPath(), `${now}\n`);
}

/** Healthy only when pid is alive, heartbeat is fresh, and control socket exists. */
export function isWorkerHealthy(now = Date.now()): boolean {
  const pid = readWorkerPid();
  if (pid === null || !pidAlive(pid)) return false;
  const heartbeat = readHeartbeatMs();
  if (heartbeat === null) return false;
  if (now - heartbeat > STALE_HEARTBEAT_MS) return false;
  if (!existsSync(controlSockPath())) return false;
  return true;
}

function lockOwnerIsLive(now = Date.now()): boolean {
  const pid = readWorkerPid();
  if (pid === null || !pidAlive(pid)) return false;
  const heartbeat = readHeartbeatMs();
  // During startup heartbeat may be absent briefly after O_EXCL lock; treat live pid + lock as held.
  if (heartbeat === null) return existsSync(workerLockPath());
  return now - heartbeat <= STALE_HEARTBEAT_MS;
}

export function clearStaleLockArtifacts(now = Date.now()): void {
  if (isWorkerHealthy(now) || lockOwnerIsLive(now)) return;
  for (const path of [workerPidPath(), workerLockPath(), heartbeatPath()]) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // best effort
    }
  }
}

/**
 * Atomic exclusive lock via O_CREAT|O_EXCL. Recover stale locks when the owner
 * pid is dead or the heartbeat is older than STALE_HEARTBEAT_MS.
 */
export function acquireWorkerLock(): LockHandle {
  const path = workerLockPath();
  mkdirSync(dirname(path), { recursive: true });

  const tryExclusive = (): LockHandle => {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    writeSync(fd, `${process.pid}\n`);
    atomicWriteText(workerPidPath(), `${process.pid}\n`);
    // Heartbeat is written after control.listen() so readiness ≠ lock-only.
    return { path, pid: process.pid, fd };
  };

  try {
    return tryExclusive();
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code: unknown }).code)
        : "";
    if (code !== "EEXIST") throw error;

    if (isWorkerHealthy() || lockOwnerIsLive()) {
      throw new Error(`worker already running (pid ${readWorkerPid()})`);
    }

    clearStaleLockArtifacts();
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
    }
    return tryExclusive();
  }
}

export function releaseWorkerLock(handle: LockHandle): void {
  try {
    closeSync(handle.fd);
  } catch {
    // ignore
  }
  for (const path of [workerPidPath(), handle.path, heartbeatPath()]) {
    try {
      if (existsSync(path)) unlinkSync(path);
    } catch {
      // ignore
    }
  }
}
