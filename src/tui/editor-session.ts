import { type ChildProcess, spawn } from "node:child_process";

export type EditorSessionHooks = {
  /** Stop periodic refresh / other TUI timers. */
  stopRefresh: () => void;
  /** Restart periodic refresh after the editor exits. */
  startRefresh: () => void;
  /** Detach stdin data listener (or equivalent) so keys do not reach onKey. */
  detachInput: () => void;
  /** Re-attach stdin data listener after restore. */
  attachInput: () => void;
  /** Leave raw mode before handing the TTY to the editor. */
  leaveRawMode: () => void;
  /** Re-enter raw mode after the editor exits. */
  enterRawMode: () => void;
  showCursor: () => void;
  hideCursor: () => void;
  /** Called after successful restore when editor exit code is 0. */
  reloadAfterSuccess: () => Promise<void>;
  /** Surface spawn/exit failures without reloading. */
  onMessage: (message: string) => void;
  /** Re-render the TUI after restore. */
  render: () => void;
};

export type SpawnEditor = (
  command: string,
  args: string[],
  options: { stdio: "inherit" },
) => ChildProcess;

export type RunExternalEditorInput = {
  editor: string;
  filePath: string;
  hooks: EditorSessionHooks;
  spawnEditor?: SpawnEditor;
  /** Prevents overlapping editor sessions (re-entry). */
  busy: { current: boolean };
};

/**
 * Suspend the interactive TUI, run $EDITOR on filePath, then restore TUI state.
 * Reloads config only when the editor exits with code 0.
 */
export async function runExternalEditorSession(input: RunExternalEditorInput): Promise<void> {
  const { editor, filePath, hooks, busy } = input;
  if (busy.current) {
    hooks.onMessage("editor already open");
    return;
  }
  busy.current = true;

  const spawnEditor = input.spawnEditor ?? spawn;
  hooks.stopRefresh();
  hooks.detachInput();
  hooks.showCursor();
  try {
    hooks.leaveRawMode();
  } catch {
    // ignore — may already be cooked
  }

  let exitCode: number | null = null;
  let spawnError: string | null = null;

  try {
    exitCode = await new Promise<number>((resolve) => {
      let child: ChildProcess;
      try {
        child = spawnEditor(editor, [filePath], { stdio: "inherit" });
      } catch (error) {
        spawnError = error instanceof Error ? error.message : String(error);
        resolve(1);
        return;
      }
      child.on("error", (error) => {
        spawnError = error.message;
        resolve(1);
      });
      child.on("exit", (code, signal) => {
        if (signal) {
          spawnError = `editor terminated by signal ${signal}`;
          resolve(1);
          return;
        }
        resolve(code ?? 1);
      });
    });
  } finally {
    try {
      hooks.enterRawMode();
    } catch {
      // ignore
    }
    hooks.hideCursor();
    hooks.attachInput();
    hooks.startRefresh();
    busy.current = false;
  }

  if (spawnError) {
    hooks.onMessage(`editor failed: ${spawnError}`);
    hooks.render();
    return;
  }
  if (exitCode !== 0) {
    hooks.onMessage(`editor exited ${exitCode}; config not reloaded`);
    hooks.render();
    return;
  }

  await hooks.reloadAfterSuccess();
}
