import { describe, expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  runExternalEditorSession,
  type EditorSessionHooks,
  type SpawnEditor,
} from "../../src/tui/editor-session.ts";

function fakeChild(opts: {
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  emitError?: Error;
  throwOnSpawn?: Error;
}): SpawnEditor {
  return () => {
    if (opts.throwOnSpawn) throw opts.throwOnSpawn;
    const child = new EventEmitter() as ChildProcess;
    queueMicrotask(() => {
      if (opts.emitError) {
        child.emit("error", opts.emitError);
        return;
      }
      child.emit("exit", opts.exitCode ?? 0, opts.signal ?? null);
    });
    return child;
  };
}

function trackingHooks(): {
  hooks: EditorSessionHooks;
  calls: string[];
  reloads: { n: number };
} {
  const calls: string[] = [];
  const reloads = { n: 0 };
  const hooks: EditorSessionHooks = {
    stopRefresh: () => calls.push("stopRefresh"),
    startRefresh: () => calls.push("startRefresh"),
    detachInput: () => calls.push("detachInput"),
    attachInput: () => calls.push("attachInput"),
    leaveRawMode: () => calls.push("leaveRawMode"),
    enterRawMode: () => calls.push("enterRawMode"),
    showCursor: () => calls.push("showCursor"),
    hideCursor: () => calls.push("hideCursor"),
    render: () => calls.push("render"),
    onMessage: (message) => calls.push(`msg:${message}`),
    reloadAfterSuccess: async () => {
      reloads.n += 1;
      calls.push("reload");
    },
  };
  return { hooks, calls, reloads };
}

describe("runExternalEditorSession", () => {
  test("suspends TUI, restores after success, and reloads only on exit 0", async () => {
    const { hooks, calls, reloads } = trackingHooks();
    await runExternalEditorSession({
      editor: "nano",
      filePath: "/tmp/automations.yaml",
      hooks,
      spawnEditor: fakeChild({ exitCode: 0 }),
      busy: { current: false },
    });

    expect(reloads.n).toBe(1);
    expect(calls.indexOf("stopRefresh")).toBeLessThan(calls.indexOf("leaveRawMode"));
    expect(calls.indexOf("detachInput")).toBeLessThan(calls.indexOf("leaveRawMode"));
    expect(calls.indexOf("showCursor")).toBeLessThan(calls.indexOf("leaveRawMode"));
    expect(calls).toContain("enterRawMode");
    expect(calls).toContain("hideCursor");
    expect(calls).toContain("attachInput");
    expect(calls).toContain("startRefresh");
    expect(calls).toContain("reload");
    expect(calls.indexOf("startRefresh")).toBeLessThan(calls.indexOf("reload"));
  });

  test("does not reload when editor exits non-zero", async () => {
    const { hooks, calls, reloads } = trackingHooks();
    await runExternalEditorSession({
      editor: "nano",
      filePath: "/tmp/x.yaml",
      hooks,
      spawnEditor: fakeChild({ exitCode: 2 }),
      busy: { current: false },
    });

    expect(reloads.n).toBe(0);
    expect(calls.some((c) => c.startsWith("msg:editor exited 2"))).toBe(true);
    expect(calls).toContain("render");
    expect(calls).toContain("startRefresh");
    expect(calls).toContain("attachInput");
  });

  test("handles spawn error without reload and still restores", async () => {
    const { hooks, calls, reloads } = trackingHooks();
    await runExternalEditorSession({
      editor: "missing-editor",
      filePath: "/tmp/x.yaml",
      hooks,
      spawnEditor: fakeChild({ emitError: new Error("ENOENT nano") }),
      busy: { current: false },
    });

    expect(reloads.n).toBe(0);
    expect(calls.some((c) => c.includes("ENOENT"))).toBe(true);
    expect(calls).toContain("enterRawMode");
    expect(calls).toContain("startRefresh");
  });

  test("blocks re-entry while busy", async () => {
    const { hooks, calls } = trackingHooks();
    await runExternalEditorSession({
      editor: "nano",
      filePath: "/tmp/x.yaml",
      hooks,
      busy: { current: true },
      spawnEditor: () => {
        throw new Error("should not spawn");
      },
    });
    expect(calls).toContain("msg:editor already open");
  });
});
