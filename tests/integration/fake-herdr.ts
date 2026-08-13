#!/usr/bin/env bun
/**
 * Deterministic fake `herdr` CLI for integration tests.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const stateDir = process.env.FAKE_HERDR_STATE ?? join(process.cwd(), ".tmp/fake-herdr");
mkdirSync(stateDir, { recursive: true });
const logPath = join(stateDir, "calls.log");
const socketPath = process.env.FAKE_HERDR_SOCKET ?? join(stateDir, "herdr.sock");

type Db = {
  workspaces: Array<{ workspace_id: string; label: string; cwd: string }>;
  tabs: Array<{
    tab_id: string;
    label: string;
    workspace_id: string;
    root_pane_id: string;
    cwd: string;
  }>;
  agents: Array<{ name: string; kind: string; pane_id: string; status: string }>;
  panes: Record<string, { output: string; alive: boolean; workspace_id: string; tab_id: string }>;
  focused_workspace_id: string | null;
};

function log(line: string): void {
  appendFileSync(logPath, `${line}\n`);
}

function ok(result: unknown): void {
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { message } })}\n`);
  process.exit(code);
}

function readDb(): Db {
  const path = join(stateDir, "db.json");
  if (!existsSync(path)) {
    const initial: Db = {
      workspaces: [],
      tabs: [],
      agents: [],
      panes: {},
      focused_workspace_id: null,
    };
    writeFileSync(path, JSON.stringify(initial, null, 2));
    return initial;
  }
  return JSON.parse(readFileSync(path, "utf8")) as Db;
}

function writeDb(db: Db): void {
  writeFileSync(join(stateDir, "db.json"), JSON.stringify(db, null, 2));
}

function argValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}

function assertUnixSocketPathLength(path: string): void {
  const bytes = Buffer.byteLength(path, "utf8");
  const max = process.platform === "darwin" ? 103 : 107;
  if (bytes > max) {
    throw new Error(
      `Unix socket path too long for ${process.platform}: ${bytes} bytes > ${max} (path=${path})`,
    );
  }
}

async function serveSocket(): Promise<void> {
  assertUnixSocketPathLength(socketPath);
  if (existsSync(socketPath)) {
    try {
      unlinkSync(socketPath);
    } catch {
      // ignore
    }
  }
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          let req: { id?: string; method?: string; params?: Record<string, unknown> };
          try {
            req = JSON.parse(line);
          } catch {
            idx = buffer.indexOf("\n");
            continue;
          }
          if (req.method === "events.subscribe") {
            socket.write(
              `${JSON.stringify({ id: req.id, ok: true, result: { subscriptions: req.params?.subscriptions ?? [] } })}\n`,
            );
            socket.write(
              `${JSON.stringify({
                type: "pane.agent_status_changed",
                id: "synthetic-1",
                data: { agent_status: "blocked", pane_id: "w1:p1", workspace_id: "w1" },
              })}\n`,
            );
          } else if (req.method === "ping") {
            socket.write(`${JSON.stringify({ id: req.id, ok: true, result: { pong: true } })}\n`);
          } else {
            socket.write(
              `${JSON.stringify({ id: req.id, ok: false, error: { message: `unsupported ${req.method}` } })}\n`,
            );
          }
        }
        idx = buffer.indexOf("\n");
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      // Ready signal after listen() — file existence alone is not enough for clients.
      const readyPath = `${socketPath}.ready`;
      writeFileSync(readyPath, `${Date.now()}\n`, "utf8");
      process.stdout.write(`FAKE_HERDR_SOCKET_READY ${socketPath}\n`);
      resolve();
    });
  });
  await new Promise(() => {});
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "__serve_socket__") {
    await serveSocket();
    return;
  }

  log(args.join(" "));
  const db = readDb();

  if (args[0] === "plugin" && args[1] === "pane" && args[2] === "open") {
    const pluginId = argValue(args, "--plugin");
    const entrypoint = argValue(args, "--entrypoint");
    const placement = argValue(args, "--placement") ?? "overlay";
    if (!pluginId || !entrypoint) fail("plugin pane open requires --plugin and --entrypoint", 1);
    ok({
      plugin_pane: {
        plugin_id: pluginId,
        entrypoint,
        placement,
      },
    });
    return;
  }

  if (args[0] === "api" && args[1] === "snapshot") {
    // Official Herdr envelope: { result: { snapshot: { workspaces, panes, ... } } }
    ok({
      snapshot: {
        workspaces: db.workspaces.map((workspace) => ({
          ...workspace,
          worktree: {
            checkout_path: workspace.cwd,
            repo_root: workspace.cwd,
            repo_key: workspace.cwd,
            repo_name: "x",
            is_linked_worktree: false,
          },
        })),
        panes: Object.entries(db.panes).map(([pane_id, pane]) => ({
          pane_id,
          workspace_id: pane.workspace_id,
          tab_id: pane.tab_id,
          cwd: db.tabs.find((tab) => tab.root_pane_id === pane_id)?.cwd ?? null,
        })),
        tabs: db.tabs,
        focused_workspace_id: db.focused_workspace_id,
      },
    });
    return;
  }

  if (args[0] === "workspace" && args[1] === "list") {
    ok({ workspaces: db.workspaces });
    return;
  }

  if (args[0] === "workspace" && args[1] === "create") {
    if (args.includes("--focus") && !args.includes("--no-focus")) fail("focus stolen", 1);
    const cwd = argValue(args, "--cwd") ?? "/tmp";
    const label = argValue(args, "--label") ?? "ws";
    const n = db.workspaces.length + 1;
    const workspace = { workspace_id: `w${n}`, label, cwd };
    db.workspaces.push(workspace);
    if (!db.focused_workspace_id) db.focused_workspace_id = "w-focus-other";
    writeDb(db);
    ok({ workspace });
    return;
  }

  if (args[0] === "tab" && args[1] === "list") {
    const workspaceId = argValue(args, "--workspace");
    const tabs = workspaceId ? db.tabs.filter((tab) => tab.workspace_id === workspaceId) : db.tabs;
    ok({ tabs });
    return;
  }

  if (args[0] === "tab" && args[1] === "create") {
    if (args.includes("--focus") && !args.includes("--no-focus")) fail("focus stolen", 1);
    const label = argValue(args, "--label") ?? "tab";
    const cwd = argValue(args, "--cwd") ?? "/tmp";
    const workspaceId = argValue(args, "--workspace");
    if (!workspaceId) fail("workspace required", 1);
    if (!db.workspaces.some((workspace) => workspace.workspace_id === workspaceId)) {
      fail(`unknown workspace ${workspaceId}`, 1);
    }
    const n = db.tabs.length + 1;
    const tab = {
      tab_id: `${workspaceId}:t${n}`,
      label,
      workspace_id: workspaceId,
      root_pane_id: `${workspaceId}:p${n}`,
      cwd,
    };
    db.tabs.push(tab);
    db.panes[tab.root_pane_id] = {
      output: "",
      alive: true,
      workspace_id: workspaceId,
      tab_id: tab.tab_id,
    };
    writeDb(db);
    ok({ tab, root_pane: { pane_id: tab.root_pane_id } });
    return;
  }

  if (args[0] === "tab" && args[1] === "get") {
    const tab = db.tabs.find((item) => item.tab_id === args[2]);
    if (!tab) fail("tab not found");
    ok({ tab, root_pane: { pane_id: tab.root_pane_id } });
    return;
  }

  if (args[0] === "pane" && args[1] === "run") {
    const paneId = args[2]!;
    const command = args.slice(3).join(" ");
    const pane = db.panes[paneId];
    if (!pane) fail("pane not found");
    if (!pane.alive) fail("pane shell dead");
    if (/\bexit\b/.test(command) && command.includes("HERDR_AUTOMATION_DONE")) {
      pane.alive = false;
    }
    const code = command.includes("fail-please") ? 7 : 0;
    pane.output += `\nran: ${command}\nHERDR_AUTOMATION_DONE:${code}\n`;
    db.panes[paneId] = pane;
    writeDb(db);
    ok({ pane_id: paneId });
    return;
  }

  if (args[0] === "pane" && args[1] === "wait-output") {
    const paneId = args[2]!;
    const pane = db.panes[paneId] ?? { output: "", alive: true, workspace_id: "", tab_id: "" };
    const match = /HERDR_AUTOMATION_DONE:(\d+)/.exec(pane.output);
    if (!match) fail("no match", 1);
    ok({ matched_line: match[0], pane_id: paneId });
    return;
  }

  if (args[0] === "pane" && args[1] === "list") {
    const workspaceId = argValue(args, "--workspace");
    const panes = Object.entries(db.panes)
      .filter(([, pane]) => !workspaceId || pane.workspace_id === workspaceId)
      .map(([pane_id, pane]) => ({
        pane_id,
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        cwd: db.tabs.find((tab) => tab.root_pane_id === pane_id)?.cwd ?? null,
      }));
    ok({ panes });
    return;
  }

  if (args[0] === "agent" && args[1] === "list") {
    ok({ agents: db.agents });
    return;
  }

  if (args[0] === "agent" && args[1] === "start") {
    const name = args[2]!;
    const kind = argValue(args, "--kind") ?? "codex";
    const paneId = argValue(args, "--pane") ?? "w1:p1";
    if (db.agents.some((agent) => agent.name === name && agent.pane_id !== paneId)) {
      fail(`agent name ${name} already in use`, 1);
    }
    db.agents = db.agents.filter((agent) => !(agent.name === name && agent.pane_id === paneId));
    db.agents.push({ name, kind, pane_id: paneId, status: "idle" });
    writeDb(db);
    ok({ agent: { name, kind, pane_id: paneId, status: "idle" } });
    return;
  }

  if (args[0] === "agent" && args[1] === "prompt") {
    const name = args[2]!;
    const agent = db.agents.find((item) => item.name === name);
    if (!agent) fail("agent not found");
    // Record prompt target for tests.
    appendFileSync(join(stateDir, "prompts.log"), `${name}:${agent.pane_id}\n`);
    agent.status = "done";
    writeDb(db);
    ok({ agent, waited: args.includes("--wait") });
    return;
  }

  fail(`unsupported fake herdr args: ${args.join(" ")}`);
}

await main();
