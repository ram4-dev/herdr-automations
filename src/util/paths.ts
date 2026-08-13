import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CONFIG_FILE_NAME,
  CONTROL_SOCK_NAME,
  HEARTBEAT_NAME,
  STATE_DB_NAME,
  WORKER_LOCK_NAME,
  WORKER_PID_NAME,
} from "../constants.ts";

export function configDir(): string {
  const dir =
    process.env.HERDR_PLUGIN_CONFIG_DIR ?? join(process.cwd(), ".herdr-automations-config");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function stateDir(): string {
  const dir = process.env.HERDR_PLUGIN_STATE_DIR ?? join(process.cwd(), ".herdr-automations-state");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function pluginRoot(): string {
  return process.env.HERDR_PLUGIN_ROOT ?? process.cwd();
}

export function configPath(): string {
  return join(configDir(), CONFIG_FILE_NAME);
}

export function dbPath(): string {
  return join(stateDir(), STATE_DB_NAME);
}

export function workerLockPath(): string {
  return join(stateDir(), WORKER_LOCK_NAME);
}

export function workerPidPath(): string {
  return join(stateDir(), WORKER_PID_NAME);
}

export function controlSockPath(): string {
  return join(stateDir(), CONTROL_SOCK_NAME);
}

export function heartbeatPath(): string {
  return join(stateDir(), HEARTBEAT_NAME);
}

export function herdrBin(): string {
  const fromEnv = process.env.HERDR_BIN_PATH;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return "herdr";
}

export function herdrSocketPath(): string | undefined {
  const value = process.env.HERDR_SOCKET_PATH;
  return value && value.length > 0 ? value : undefined;
}
