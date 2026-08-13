import { configPath } from "../util/paths.ts";
import { sleep, toIso } from "../util/time.ts";
import { controlRequest } from "../worker/control.ts";
import { ensureWorker } from "../worker/ensure.ts";
import { runExternalEditorSession } from "./editor-session.ts";

type AutomationRow = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  nextRunAt: number | null;
  lastStatus: string | null;
  lastFinishedAt: number | null;
  running: boolean;
};

type StatusResult = {
  pid: number;
  paused: boolean;
  configError: string | null;
  activeRuns: number;
  automations: AutomationRow[];
};

type Mode = "list" | "history" | "help";

function write(text: string): void {
  process.stdout.write(text);
}

function clearScreen(): void {
  write("\x1b[2J\x1b[H");
}

function hideCursor(): void {
  write("\x1b[?25l");
}

function showCursor(): void {
  write("\x1b[?25h");
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text.padEnd(width);
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

async function fetchStatus(): Promise<{ ok: boolean; result?: StatusResult; error?: string }> {
  const response = await controlRequest("status");
  if (!response.ok) return { ok: false, error: response.error };
  return { ok: true, result: response.result as StatusResult };
}

export async function runTui(): Promise<number> {
  await ensureWorker();
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const status = await fetchStatus();
    console.log(JSON.stringify(status, null, 2));
    return status.ok ? 0 : 1;
  }

  let selected = 0;
  let mode: Mode = "list";
  let message = "";
  let historyText = "";
  let status: StatusResult | null = null;
  let alive = true;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  const editorBusy = { current: false };

  const refresh = async () => {
    if (editorBusy.current) return;
    const next = await fetchStatus();
    if (editorBusy.current) return;
    if (next.ok && next.result) {
      status = next.result;
      if (selected >= status.automations.length) {
        selected = Math.max(0, status.automations.length - 1);
      }
    } else {
      message = next.error ?? "status failed";
    }
    render();
  };

  const stopRefresh = () => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  };

  const startRefresh = () => {
    stopRefresh();
    refreshTimer = setInterval(() => {
      void refresh();
    }, 2000);
  };

  const render = () => {
    clearScreen();
    const paused = status?.paused ? "PAUSED" : "RUNNING";
    const cfgErr = status?.configError ? ` | config error: ${status.configError}` : "";
    write(`Herdr Automations  worker=${status?.pid ?? "?"}  ${paused}${cfgErr}\n`);
    write(`config: ${configPath()}\n`);
    write("──────────────────────────────────────────────────────────────────────────────\n");

    if (mode === "help") {
      write(`Keys:
  j/k or ↑/↓   move
  r            reload YAML
  p            pause/resume all
  e            enable/disable selected
  n            run now
  c            cancel latest queued run
  t            retry last failed/interrupted
  h            history / diagnostics
  o            open config in $EDITOR (create/edit/delete)
  ?            help
  q/Esc        quit
`);
      write(`\n${message}\n`);
      return;
    }

    if (mode === "history") {
      write(historyText || "(no history)");
      write(`\n\n${message}\n[q] back\n`);
      return;
    }

    write(
      `${truncate("STATUS", 10)} ${truncate("ID", 18)} ${truncate("TRIGGER", 28)} ${truncate("NEXT", 22)} ${truncate("LAST", 18)}\n`,
    );
    const rows = status?.automations ?? [];
    if (rows.length === 0) {
      write("\n(no automations loaded — press o to edit YAML, then r to reload)\n");
    }
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row) continue;
      const marker = i === selected ? ">" : " ";
      const state = row.running ? "running" : row.enabled ? "enabled" : "disabled";
      const next = row.nextRunAt ? toIso(row.nextRunAt) : "-";
      const last = row.lastStatus
        ? `${row.lastStatus}${row.lastFinishedAt ? `@${toIso(row.lastFinishedAt)}` : ""}`
        : "-";
      write(
        `${marker}${truncate(state, 9)} ${truncate(row.id, 18)} ${truncate(row.trigger, 28)} ${truncate(next ?? "-", 22)} ${truncate(last, 18)}\n`,
      );
    }
    write("──────────────────────────────────────────────────────────────────────────────\n");
    write(
      "[?] help  [r] reload  [p] pause  [e] enable  [n] run  [c] cancel  [t] retry  [h] hist  [o] config  [q] quit\n",
    );
    if (message) write(`${message}\n`);
  };

  const selectedId = () => status?.automations[selected]?.id ?? null;

  const onData = (chunk: string) => {
    if (editorBusy.current) return;
    void onKey(chunk);
  };

  const onKey = async (key: string) => {
    if (editorBusy.current) return;
    if (mode === "history") {
      if (key === "q" || key === "\x1b") {
        mode = "list";
        message = "";
        render();
      }
      return;
    }
    if (mode === "help") {
      if (key === "q" || key === "\x1b" || key === "?") {
        mode = "list";
        render();
      }
      return;
    }

    if (key === "q" || key === "\x1b") {
      alive = false;
      return;
    }
    if (key === "?") {
      mode = "help";
      render();
      return;
    }
    if (key === "j" || key === "\x1b[B") {
      selected = Math.min((status?.automations.length ?? 1) - 1, selected + 1);
      render();
      return;
    }
    if (key === "k" || key === "\x1b[A") {
      selected = Math.max(0, selected - 1);
      render();
      return;
    }
    if (key === "r") {
      const response = await controlRequest("reload");
      message = response.ok ? "reloaded" : `reload failed: ${response.error}`;
      await refresh();
      return;
    }
    if (key === "p") {
      const response = await controlRequest(status?.paused ? "resume" : "pause");
      message = response.ok
        ? status?.paused
          ? "resumed"
          : "paused"
        : `pause/resume failed: ${response.error}`;
      await refresh();
      return;
    }
    if (key === "e") {
      const id = selectedId();
      if (!id) return;
      const row = status?.automations[selected];
      const response = await controlRequest(row?.enabled ? "disable" : "enable", { id });
      message = response.ok
        ? `${id} ${row?.enabled ? "disabled" : "enabled"}`
        : (response.error ?? "failed");
      await refresh();
      return;
    }
    if (key === "n") {
      const id = selectedId();
      if (!id) return;
      const response = await controlRequest("run-now", { id });
      message = response.ok ? `queued ${id}` : (response.error ?? "run-now failed");
      await refresh();
      return;
    }
    if (key === "c") {
      const id = selectedId();
      if (!id) return;
      const response = await controlRequest("cancel", { id });
      message = response.ok
        ? `cancelled queued run ${String((response.result as { runId?: string })?.runId ?? id)}`
        : (response.error ?? "cancel failed");
      await refresh();
      return;
    }
    if (key === "t") {
      const id = selectedId();
      if (!id) return;
      const response = await controlRequest("retry", { id });
      message = response.ok ? `retry queued ${id}` : (response.error ?? "retry failed");
      await refresh();
      return;
    }
    if (key === "h") {
      const id = selectedId();
      if (!id) return;
      const response = await controlRequest("history", { id, limit: 15 });
      if (!response.ok) {
        message = response.error ?? "history failed";
        render();
        return;
      }
      const runs = (response.result as { runs: Array<Record<string, unknown>> }).runs ?? [];
      historyText = runs
        .map((run) => {
          const statusValue = String(run.status ?? "");
          const summary = String(run.summary ?? "");
          const error = run.error ? ` err=${String(run.error)}` : "";
          return `${run.id} ${statusValue} ${summary}${error}`;
        })
        .join("\n");
      mode = "history";
      message = `history for ${id}`;
      render();
      return;
    }
    if (key === "o") {
      const editor = process.env.EDITOR || process.env.VISUAL || "nano";
      await runExternalEditorSession({
        editor,
        filePath: configPath(),
        busy: editorBusy,
        hooks: {
          stopRefresh,
          startRefresh,
          detachInput: () => {
            process.stdin.off("data", onData);
          },
          attachInput: () => {
            process.stdin.on("data", onData);
          },
          leaveRawMode: () => {
            if (process.stdin.isTTY) process.stdin.setRawMode(false);
          },
          enterRawMode: () => {
            if (process.stdin.isTTY) process.stdin.setRawMode(true);
          },
          showCursor,
          hideCursor,
          onMessage: (text) => {
            message = text;
          },
          render,
          reloadAfterSuccess: async () => {
            const response = await controlRequest("reload");
            message = response.ok
              ? "opened config and reloaded"
              : `config edited; reload error: ${response.error}`;
            await refresh();
          },
        },
      });
    }
  };

  hideCursor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", onData);

  await refresh();
  startRefresh();

  while (alive) {
    await sleep(50);
  }

  stopRefresh();
  process.stdin.off("data", onData);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  showCursor();
  clearScreen();
  return 0;
}
