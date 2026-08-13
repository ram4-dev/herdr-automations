import { existsSync, writeFileSync } from "node:fs";
import { exampleConfigYaml, loadConfigFile } from "../config/load.ts";
import { HEARTBEAT_INTERVAL_MS, SCHEDULER_TICK_MS } from "../constants.ts";
import { HerdrSocket } from "../herdr/socket.ts";
import { normalizeHerdrEvent } from "../triggers/events.ts";
import { Store } from "../store/db.ts";
import { configPath, herdrSocketPath } from "../util/paths.ts";
import { sanitizeError } from "../util/redaction.ts";
import { ControlServer, type ControlRequest, type ControlResponse } from "./control.ts";
import { acquireWorkerLock, releaseWorkerLock, writeHeartbeat, type LockHandle } from "./lock.ts";
import { Scheduler } from "./scheduler.ts";

export async function runWorker(): Promise<void> {
  let lock: LockHandle | null = null;
  const store = new Store();
  const scheduler = new Scheduler(store);
  let socket: HerdrSocket | null = null;
  let control: ControlServer | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[automations] shutting down on ${signal}`);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (tickTimer) clearInterval(tickTimer);
    control?.close();
    socket?.close();
    store.close();
    if (lock) releaseWorkerLock(lock);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  try {
    lock = acquireWorkerLock();
  } catch (error) {
    console.error(`[automations] ${sanitizeError(error)}`);
    process.exit(1);
  }

  store.markAbandonedRunsInterrupted();
  ensureDefaultConfig();
  reloadConfig(store, scheduler);

  control = new ControlServer(async (request) => handleControl(request, store, scheduler));
  await control.start();
  // Readiness: control socket is listening; heartbeat unlocks ensureWorker/isWorkerHealthy.
  writeHeartbeat();

  heartbeatTimer = setInterval(() => writeHeartbeat(), HEARTBEAT_INTERVAL_MS);
  tickTimer = setInterval(() => scheduler.tick(), SCHEDULER_TICK_MS);

  const socketPath = herdrSocketPath();
  if (socketPath) {
    socket = new HerdrSocket(socketPath, () => {
      console.error("[automations] herdr socket disconnected; will reconnect");
    });
    // Do not block control readiness on Herdr subscribe.
    void connectAndSubscribe(socket, scheduler).catch((error) => {
      console.error(`[automations] subscribe failed: ${sanitizeError(error)}`);
    });
  } else {
    console.error("[automations] HERDR_SOCKET_PATH unset; event triggers disabled until available");
  }

  console.error(`[automations] worker ready pid=${process.pid}`);
  await new Promise(() => {});
}

async function connectAndSubscribe(socket: HerdrSocket, scheduler: Scheduler): Promise<void> {
  const subscribeAll = async () => {
    await socket.connect();
    const eventTypes = new Set<string>();
    for (const automation of scheduler.getAutomations()) {
      if (automation.trigger.type === "event") eventTypes.add(automation.trigger.event);
    }
    const subscriptions = [
      { type: "pane.agent_status_changed" },
      { type: "pane.closed" },
      { type: "pane.exited" },
      { type: "worktree.created" },
      { type: "workspace.created" },
      ...[...eventTypes].map((type) => ({ type })),
    ];
    const unique = Array.from(new Map(subscriptions.map((item) => [item.type, item])).values());
    await socket.subscribe(unique, (message) => {
      const normalized = normalizeHerdrEvent(message);
      if (!normalized.event || normalized.event === "events.subscribe") return;
      if (message.ok !== undefined && message.result !== undefined && !message.data) return;
      scheduler.handleEvent(normalized.event, {
        type: normalized.event,
        event: normalized.event,
        data: normalized.data,
        id: normalized.envelope.id,
      });
    });
  };

  await subscribeAll();
  setInterval(() => {
    void subscribeAll().catch(() => undefined);
  }, 15_000);
}

function ensureDefaultConfig(): void {
  const path = configPath();
  if (!existsSync(path)) {
    writeFileSync(path, exampleConfigYaml(), "utf8");
  }
}

function reloadConfig(store: Store, scheduler: Scheduler): { ok: boolean; error?: string } {
  const loaded = loadConfigFile();
  if (!loaded.ok) {
    store.setConfigError(loaded.error);
    return { ok: false, error: loaded.error };
  }
  store.setConfigError(null);
  scheduler.setAutomations(loaded.automations);
  return { ok: true };
}

async function handleControl(
  request: ControlRequest,
  store: Store,
  scheduler: Scheduler,
): Promise<ControlResponse> {
  const method = request.method;
  const params = request.params ?? {};
  switch (method) {
    case "ping":
      return { ok: true, result: { pid: process.pid } };
    case "status":
      return {
        ok: true,
        result: {
          pid: process.pid,
          paused: store.getPaused(),
          configError: store.getConfigError(),
          activeRuns: store.countActiveRuns(),
          automations: scheduler.snapshot(),
        },
      };
    case "reload": {
      const result = reloadConfig(store, scheduler);
      return result.ok
        ? { ok: true, result: { reloaded: true } }
        : { ok: false, error: result.error ?? "reload failed" };
    }
    case "pause":
      store.setPaused(true);
      for (const automation of scheduler.getAutomations()) {
        store.setNextRunAt(automation.id, null);
      }
      return { ok: true, result: { paused: true } };
    case "resume":
      store.setPaused(false);
      scheduler.setAutomations(scheduler.getAutomations());
      return { ok: true, result: { paused: false } };
    case "run-now": {
      const id = String(params.id ?? "");
      if (!id) return { ok: false, error: "missing automation id" };
      const result = await scheduler.runNow(id);
      return "error" in result ? { ok: false, error: result.error } : { ok: true, result };
    }
    case "retry": {
      const id = String(params.id ?? "");
      if (!id) return { ok: false, error: "missing automation id" };
      const result = await scheduler.retry(id);
      return "error" in result ? { ok: false, error: result.error } : { ok: true, result };
    }
    case "cancel": {
      const id = String(params.id ?? "");
      if (!id) return { ok: false, error: "missing automation id" };
      const result = scheduler.cancel(id);
      return "error" in result ? { ok: false, error: result.error } : { ok: true, result };
    }
    case "enable": {
      const id = String(params.id ?? "");
      if (!id) return { ok: false, error: "missing automation id" };
      scheduler.setEnabled(id, true);
      return { ok: true, result: { id, enabled: true } };
    }
    case "disable": {
      const id = String(params.id ?? "");
      if (!id) return { ok: false, error: "missing automation id" };
      scheduler.setEnabled(id, false);
      return { ok: true, result: { id, enabled: false } };
    }
    case "history": {
      const id = String(params.id ?? "");
      if (!id) return { ok: false, error: "missing automation id" };
      return { ok: true, result: { runs: store.listRuns(id, Number(params.limit ?? 20)) } };
    }
    default:
      return { ok: false, error: `unknown method ${method}` };
  }
}
