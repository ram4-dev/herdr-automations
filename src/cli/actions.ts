import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadConfigFile } from "../config/load.ts";
import { openAutomationsPopup } from "../herdr/open-popup.ts";
import { Store } from "../store/db.ts";
import { configPath } from "../util/paths.ts";
import { controlRequest } from "../worker/control.ts";
import { ensureWorker } from "../worker/ensure.ts";
import { isWorkerHealthy, readHeartbeatMs, readWorkerPid } from "../worker/lock.ts";

function automationIdFromEnv(): string | null {
  const direct = process.env.AUTOMATION_ID?.trim();
  if (direct) return direct;
  const argvId = process.argv[3]?.trim();
  if (argvId) return argvId;
  try {
    const context = JSON.parse(process.env.HERDR_PLUGIN_CONTEXT_JSON ?? "{}") as Record<
      string,
      unknown
    >;
    const selected =
      (typeof context.selected_text === "string" && context.selected_text) ||
      (typeof context.selectedText === "string" && context.selectedText) ||
      null;
    if (selected && /^[a-z][a-z0-9_-]{0,63}$/.test(selected.trim())) {
      return selected.trim();
    }
  } catch {
    // ignore
  }
  return null;
}

async function withWorker<T>(fn: () => Promise<T>): Promise<T> {
  await ensureWorker();
  return fn();
}

export async function actionOpen(): Promise<number> {
  // Do not run the TUI here: action invoke is non-interactive and only logs stdout.
  const result = await openAutomationsPopup();
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  console.log(
    JSON.stringify({ ok: true, result: { opened: "board", placement: "popup" } }, null, 2),
  );
  return 0;
}

export async function actionStatus(): Promise<number> {
  const local = {
    workerHealthy: isWorkerHealthy(),
    workerPid: readWorkerPid(),
    heartbeatMs: readHeartbeatMs(),
    configPath: configPath(),
    config: loadConfigFile(),
  };
  if (!local.workerHealthy) {
    console.log(JSON.stringify({ ok: true, result: { ...local, worker: null } }, null, 2));
    return 0;
  }
  const response = await withWorker(() => controlRequest("status"));
  console.log(JSON.stringify({ ...response, local }, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionReload(): Promise<number> {
  const response = await withWorker(() => controlRequest("reload"));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionPause(): Promise<number> {
  const response = await withWorker(() => controlRequest("pause"));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionResume(): Promise<number> {
  const response = await withWorker(() => controlRequest("resume"));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionRunNow(): Promise<number> {
  const id = automationIdFromEnv();
  if (!id) {
    console.error("missing automation id (AUTOMATION_ID, argv, or selected_text)");
    return 2;
  }
  const response = await withWorker(() => controlRequest("run-now", { id }));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionRetry(): Promise<number> {
  const id = automationIdFromEnv();
  if (!id) {
    console.error("missing automation id (AUTOMATION_ID, argv, or selected_text)");
    return 2;
  }
  const response = await withWorker(() => controlRequest("retry", { id }));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionCancel(): Promise<number> {
  const id = automationIdFromEnv();
  if (!id) {
    console.error("missing automation id (AUTOMATION_ID, argv, or selected_text)");
    return 2;
  }
  const response = await withWorker(() => controlRequest("cancel", { id }));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionEnable(): Promise<number> {
  const id = automationIdFromEnv();
  if (!id) {
    console.error("missing automation id (AUTOMATION_ID, argv, or selected_text)");
    return 2;
  }
  const response = await withWorker(() => controlRequest("enable", { id }));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionDisable(): Promise<number> {
  const id = automationIdFromEnv();
  if (!id) {
    console.error("missing automation id (AUTOMATION_ID, argv, or selected_text)");
    return 2;
  }
  const response = await withWorker(() => controlRequest("disable", { id }));
  console.log(JSON.stringify(response, null, 2));
  return response.ok ? 0 : 1;
}

export async function actionOpenConfig(): Promise<number> {
  const path = configPath();
  if (!existsSync(path)) {
    console.error(`config missing: ${path}`);
    return 1;
  }
  const editor = process.env.EDITOR || process.env.VISUAL || "nano";
  const child = spawn(editor, [path], { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => {
    child.on("exit", (value) => resolve(value ?? 1));
  });
  if (code === 0 && isWorkerHealthy()) {
    await controlRequest("reload");
  }
  return code;
}

export async function actionDiagnostics(): Promise<number> {
  const store = new Store();
  try {
    const active = store.listActiveRuns();
    const paused = store.getPaused();
    const configError = store.getConfigError();
    console.log(
      JSON.stringify(
        {
          ok: true,
          result: {
            paused,
            configError,
            active,
            workerHealthy: isWorkerHealthy(),
            workerPid: readWorkerPid(),
          },
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    store.close();
  }
}
