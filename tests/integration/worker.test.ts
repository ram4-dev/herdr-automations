import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { executeAction } from "../../src/herdr/runners.ts";
import { HerdrSocket } from "../../src/herdr/socket.ts";
import { ensureAutomationTab } from "../../src/herdr/tabs.ts";
import { ensureWorkspaceForCwd } from "../../src/herdr/workspaces.ts";
import { eventMatches } from "../../src/triggers/events.ts";
import { controlSockPath } from "../../src/util/paths.ts";
import { controlRequest } from "../../src/worker/control.ts";
import { ensureWorker } from "../../src/worker/ensure.ts";
import { isWorkerHealthy, readWorkerPid } from "../../src/worker/lock.ts";
import { assertUnixSocketPathLength, shortSocketTempDir } from "../helpers/short-tmp.ts";

type Spawned = ReturnType<typeof Bun.spawn>;

const roots: string[] = [];
const children: Spawned[] = [];
const trackedPids = new Set<number>();

function trackPid(pid: number | null | undefined): void {
  if (typeof pid === "number" && pid > 0) trackedPids.add(pid);
}

async function killPid(pid: number): Promise<void> {
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
    const deadline = Date.now() + 400;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(20);
      } catch {
        return;
      }
    }
  }
}

async function reapTrackedProcesses(): Promise<void> {
  for (const child of children.splice(0)) {
    trackPid(child.pid);
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  const pidFromState = readWorkerPid();
  if (pidFromState) trackPid(pidFromState);
  for (const pid of [...trackedPids]) {
    await killPid(pid);
    trackedPids.delete(pid);
  }
  // Wait briefly for control sock from this env to disappear.
  const control = (() => {
    try {
      return controlSockPath();
    } catch {
      return null;
    }
  })();
  if (control) {
    const deadline = Date.now() + 500;
    while (existsSync(control) && Date.now() < deadline) {
      await Bun.sleep(20);
    }
  }
}

beforeAll(async () => {
  // Warm the fake-herdr module so the first suite is not dominated by cold compile.
  // Socket roots must stay short on macOS (sun_path); use /private/tmp/hra-*.
  const warmRoot = shortSocketTempDir("hra-warm-");
  const socketPath = join(warmRoot, "h.sock");
  assertUnixSocketPathLength(socketPath);
  const child = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "fake-herdr.ts"), "__serve_socket__"],
    env: {
      ...process.env,
      FAKE_HERDR_STATE: warmRoot,
      FAKE_HERDR_SOCKET: socketPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await waitForFakeSocketReady(child, socketPath, 10_000);
  } finally {
    try {
      child.kill();
    } catch {
      // ignore
    }
    await child.exited.catch(() => undefined);
    rmSync(warmRoot, { recursive: true, force: true });
  }
});

afterEach(async () => {
  await reapTrackedProcesses();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
  delete process.env.HERDR_BIN_PATH;
  delete process.env.HERDR_SOCKET_PATH;
  delete process.env.HERDR_PLUGIN_CONFIG_DIR;
  delete process.env.HERDR_PLUGIN_STATE_DIR;
  delete process.env.FAKE_HERDR_STATE;
  delete process.env.FAKE_HERDR_SOCKET;
});

function setup(): {
  root: string;
  configDir: string;
  stateDir: string;
  fakeBin: string;
  fakeState: string;
  socketPath: string;
} {
  // Real Unix sockets (fake Herdr + worker control) require a short root on macOS.
  const root = shortSocketTempDir("hra-");
  roots.push(root);
  const configDir = join(root, "c");
  const stateDir = join(root, "s");
  const fakeState = join(root, "f");
  const binDir = join(root, "b");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(fakeState, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const fakeSrc = join(import.meta.dir, "fake-herdr.ts");
  const fakeBin = join(binDir, "herdr");
  writeFileSync(
    fakeBin,
    `#!/usr/bin/env bash
exec bun ${JSON.stringify(fakeSrc)} "$@"
`,
    { mode: 0o755 },
  );

  const socketPath = join(fakeState, "h.sock");
  const controlPath = join(stateDir, "control.sock");
  assertUnixSocketPathLength(socketPath);
  assertUnixSocketPathLength(controlPath);
  process.env.HERDR_PLUGIN_CONFIG_DIR = configDir;
  process.env.HERDR_PLUGIN_STATE_DIR = stateDir;
  process.env.HERDR_PLUGIN_ROOT = join(import.meta.dir, "../..");
  process.env.HERDR_BIN_PATH = fakeBin;
  process.env.HERDR_SOCKET_PATH = socketPath;
  process.env.FAKE_HERDR_STATE = fakeState;
  process.env.FAKE_HERDR_SOCKET = socketPath;

  writeFileSync(
    join(configDir, "automations.yaml"),
    `version: 1
defaults:
  timezone: America/Argentina/Buenos_Aires
  overlap: skip
  catch_up: latest
  timeout_seconds: 30
automations:
  - id: demo-cmd
    enabled: false
    cwd: /tmp/project-a
    trigger:
      type: interval
      every: 1h
    action:
      type: command
      command: ["echo", "demo"]
`,
  );

  return { root, configDir, stateDir, fakeBin, fakeState, socketPath };
}

async function drainStream(stream: unknown, onChunk: (text: string) => void): Promise<void> {
  if (!stream || typeof stream !== "object" || !("getReader" in stream)) return;
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) onChunk(decoder.decode(value));
  }
}

async function pingUnixSocket(path: string, timeoutMs = 200): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(path);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("ping timeout"));
    }, timeoutMs);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ id: "ready_ping", method: "ping", params: {} })}\n`);
    });
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.end();
      if (buffer.includes('"ok":true') || buffer.includes('"pong"')) resolve();
      else reject(new Error(`unexpected ping response: ${buffer.trim()}`));
    });
    socket.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Wait until the fake Herdr socket accepts a ping.
 * Fails immediately if the child exits; does not treat path existence as ready.
 */
async function waitForFakeSocketReady(
  child: Spawned,
  socketPath: string,
  timeoutMs = 5_000,
): Promise<{ stdout: string; stderr: string }> {
  trackPid(child.pid);
  let stdout = "";
  let stderr = "";
  const stdoutTask = drainStream(child.stdout ?? null, (chunk) => {
    stdout += chunk;
  });
  const stderrTask = drainStream(child.stderr ?? null, (chunk) => {
    stderr += chunk;
  });

  const ready = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(
          `fake herdr socket server exited code=${child.exitCode} stderr=${stderr.trim() || "(empty)"} stdout=${stdout.trim() || "(empty)"}`,
        );
      }
      if (stdout.includes("FAKE_HERDR_SOCKET_READY") || existsSync(`${socketPath}.ready`)) {
        try {
          await pingUnixSocket(socketPath);
          return "ready" as const;
        } catch {
          // Accept loop may still be binding; keep polling.
        }
      } else if (existsSync(socketPath)) {
        try {
          await pingUnixSocket(socketPath);
          return "ready" as const;
        } catch {
          // Not accepting yet.
        }
      }
      await Bun.sleep(20);
    }
    throw new Error(
      `fake herdr socket not connectable within ${timeoutMs}ms path=${socketPath} stderr=${stderr.trim() || "(empty)"} stdout=${stdout.trim() || "(empty)"}`,
    );
  })();

  const exitWatch = child.exited.then(
    (code) => ({ kind: "exit" as const, code }),
    (error) => ({ kind: "exit" as const, code: -1, error }),
  );
  const readyWatch = ready.then(() => ({ kind: "ready" as const }));
  const winner = await Promise.race([readyWatch, exitWatch]);
  if (winner.kind === "exit") {
    throw new Error(
      `fake herdr socket server exited early code=${winner.code} stderr=${stderr.trim() || "(empty)"} stdout=${stdout.trim() || "(empty)"}`,
    );
  }
  // Keep drains alive for the child lifetime; do not await EOF here.
  void stdoutTask;
  void stderrTask;
  return { stdout, stderr };
}

async function startFakeSocketServer(socketPath: string, fakeState: string): Promise<Spawned> {
  const child = Bun.spawn({
    cmd: ["bun", join(import.meta.dir, "fake-herdr.ts"), "__serve_socket__"],
    env: {
      ...process.env,
      FAKE_HERDR_STATE: fakeState,
      FAKE_HERDR_SOCKET: socketPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  await waitForFakeSocketReady(child, socketPath);
  return child;
}

describe("integration fake herdr", () => {
  test("routes tabs by cwd workspace, not focused workspace", async () => {
    const ctx = setup();
    writeFileSync(
      join(ctx.fakeState, "db.json"),
      JSON.stringify(
        {
          workspaces: [{ workspace_id: "w-focus", label: "focused", cwd: "/tmp/other" }],
          tabs: [],
          agents: [],
          panes: {},
          focused_workspace_id: "w-focus",
        },
        null,
        2,
      ),
    );

    const wsA = await ensureWorkspaceForCwd("/tmp/project-a");
    const wsB = await ensureWorkspaceForCwd("/tmp/project-b");
    expect(wsA.workspace_id).not.toBe(wsB.workspace_id);
    expect(wsA.workspace_id).not.toBe("w-focus");

    const tabA = await ensureAutomationTab({
      automationId: "demo-cmd",
      cwd: "/tmp/project-a",
    });
    const tabB = await ensureAutomationTab({
      automationId: "demo-cmd",
      cwd: "/tmp/project-b",
    });
    expect(tabA.workspace_id).toBe(wsA.workspace_id);
    expect(tabB.workspace_id).toBe(wsB.workspace_id);
    expect(tabA.tab_id).not.toBe(tabB.tab_id);

    const log = readFileSync(join(ctx.fakeState, "calls.log"), "utf8");
    expect(log.includes("--no-focus")).toBe(true);
    expect(log.includes("workspace create")).toBe(true);
    expect(log.includes(`--workspace ${wsA.workspace_id}`)).toBe(true);
    expect(log.includes(`--workspace ${wsB.workspace_id}`)).toBe(true);
  });

  test("official snapshot envelope reuses existing cwd workspace without create", async () => {
    const ctx = setup();
    writeFileSync(
      join(ctx.fakeState, "db.json"),
      JSON.stringify(
        {
          workspaces: [
            { workspace_id: "w-existing", label: "existing", cwd: "/tmp/project-a" },
            { workspace_id: "w-focus", label: "focused", cwd: "/tmp/other" },
          ],
          tabs: [],
          agents: [],
          panes: {},
          focused_workspace_id: "w-focus",
        },
        null,
        2,
      ),
    );

    const first = await ensureWorkspaceForCwd("/tmp/project-a");
    const second = await ensureWorkspaceForCwd("/tmp/project-a");
    expect(first.workspace_id).toBe("w-existing");
    expect(second.workspace_id).toBe("w-existing");

    const tab1 = await ensureAutomationTab({
      automationId: "reuse-cmd",
      cwd: "/tmp/project-a",
    });
    const tab2 = await ensureAutomationTab({
      automationId: "reuse-cmd",
      cwd: "/tmp/project-a",
    });
    expect(tab1.workspace_id).toBe("w-existing");
    expect(tab2.workspace_id).toBe("w-existing");
    expect(tab1.tab_id).toBe(tab2.tab_id);

    const log = readFileSync(join(ctx.fakeState, "calls.log"), "utf8");
    expect(log.includes("api snapshot")).toBe(true);
    expect(log.includes("workspace create")).toBe(false);
  });

  test("command completion preserves pane for second run", async () => {
    setup();
    const first = await executeAction({
      automationId: "demo-cmd",
      cwd: "/tmp/project-a",
      timeoutSeconds: 10,
      action: { type: "command", command: ["echo", "ok"], env: {} },
    });
    expect(first.status).toBe("succeeded");
    const second = await executeAction({
      automationId: "demo-cmd",
      cwd: "/tmp/project-a",
      timeoutSeconds: 10,
      action: { type: "command", command: ["echo", "again"], env: {} },
    });
    expect(second.status).toBe("succeeded");
    expect(second.exitCode).toBe(0);
  });

  test("agent with same name outside automation pane is refused", async () => {
    const ctx = setup();
    const tab = await ensureAutomationTab({ automationId: "demo-agent", cwd: "/tmp/project-a" });
    const dbPath = join(ctx.fakeState, "db.json");
    const db = JSON.parse(readFileSync(dbPath, "utf8")) as {
      workspaces: Array<Record<string, string>>;
      tabs: Array<Record<string, string>>;
      agents: Array<Record<string, string>>;
      panes: Record<string, Record<string, unknown>>;
      focused_workspace_id: string | null;
    };
    db.workspaces.push({ workspace_id: "w-other", label: "other", cwd: "/tmp/other" });
    db.tabs.push({
      tab_id: "w-other:t9",
      label: "foreign",
      workspace_id: "w-other",
      root_pane_id: "w-other:p9",
      cwd: "/tmp/other",
    });
    db.panes["w-other:p9"] = {
      output: "",
      alive: true,
      workspace_id: "w-other",
      tab_id: "w-other:t9",
    };
    db.agents.push({
      name: "auto-demo",
      kind: "codex",
      pane_id: "w-other:p9",
      status: "idle",
    });
    writeFileSync(dbPath, JSON.stringify(db, null, 2));

    const result = await executeAction({
      automationId: "demo-agent",
      cwd: "/tmp/project-a",
      timeoutSeconds: 10,
      action: {
        type: "agent",
        kind: "codex",
        name: "auto-demo",
        prompt: "should not be delivered",
      },
    });
    expect(result.status).toBe("failed");
    expect(result.error ?? "").toContain("already in use outside automation pane");
    expect(existsSync(join(ctx.fakeState, "prompts.log"))).toBe(false);
    expect(tab.root_pane_id).toBeTruthy();
  });

  test("agent reuses only when living in the automation pane", async () => {
    setup();
    const first = await executeAction({
      automationId: "demo-agent",
      cwd: "/tmp/project-a",
      timeoutSeconds: 10,
      action: {
        type: "agent",
        kind: "codex",
        name: "auto-demo",
        prompt: "hello",
      },
    });
    expect(first.status).toBe("succeeded");
    const second = await executeAction({
      automationId: "demo-agent",
      cwd: "/tmp/project-a",
      timeoutSeconds: 10,
      action: {
        type: "agent",
        kind: "codex",
        name: "auto-demo",
        prompt: "hello again",
      },
    });
    expect(second.status).toBe("succeeded");
  });

  test("open action requests plugin pane popup board (does not run TUI inline)", async () => {
    const ctx = setup();
    const { actionOpen } = await import("../../src/cli/actions.ts");
    const code = await actionOpen();
    expect(code).toBe(0);
    const log = readFileSync(join(ctx.fakeState, "calls.log"), "utf8");
    expect(log).toContain(
      "plugin pane open --plugin ram4.herdr-automations --entrypoint board --placement popup",
    );
    expect(log.includes("src/main.ts ui")).toBe(false);
  });

  test("worker ensure + control reload/status + socket subscribe", async () => {
    const ctx = setup();
    await startFakeSocketServer(ctx.socketPath, ctx.fakeState);

    const ensured = await ensureWorker();
    trackPid(ensured.pid);
    expect(ensured.pid).not.toBeNull();
    expect(isWorkerHealthy()).toBe(true);

    const status = await controlRequest("status");
    expect(status.ok).toBe(true);
    const reload = await controlRequest("reload");
    expect(reload.ok).toBe(true);

    const socket = new HerdrSocket(ctx.socketPath);
    let sawBlocked = false;
    await socket.subscribe([{ type: "pane.agent_status_changed" }], (event) => {
      if (eventMatches({ agent_status: "blocked" }, event)) sawBlocked = true;
    });
    const start = Date.now();
    while (!sawBlocked && Date.now() - start < 1_000) {
      await Bun.sleep(20);
    }
    expect(sawBlocked).toBe(true);
    socket.close();
  });
});
