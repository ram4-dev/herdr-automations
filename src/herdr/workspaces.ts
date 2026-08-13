import { realpathSync } from "node:fs";
import { herdr, herdrErrorMessage } from "./cli.ts";

export type WorkspaceInfo = {
  workspace_id: string;
  label?: string | null;
  cwd?: string | null;
  checkout_path?: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export function canonicalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // Path may not exist yet; still normalize trailing slashes.
    return path.replace(/\/+$/, "") || "/";
  }
}

function pathsEqual(a: string, b: string): boolean {
  return canonicalizePath(a) === canonicalizePath(b);
}

function workspaceFromRecord(record: Record<string, unknown>): WorkspaceInfo | null {
  const workspaceId =
    typeof record.workspace_id === "string"
      ? record.workspace_id
      : typeof record.id === "string"
        ? record.id
        : null;
  if (!workspaceId) return null;
  const worktree = asRecord(record.worktree);
  const cwd =
    typeof record.cwd === "string"
      ? record.cwd
      : typeof worktree?.checkout_path === "string"
        ? worktree.checkout_path
        : typeof worktree?.repo_root === "string"
          ? worktree.repo_root
          : null;
  return {
    workspace_id: workspaceId,
    label: typeof record.label === "string" ? record.label : null,
    cwd,
    checkout_path: typeof worktree?.checkout_path === "string" ? worktree.checkout_path : null,
  };
}

function workspacesFromPayload(payload: Record<string, unknown> | null): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload.workspaces)) return payload.workspaces;
  return [];
}

function panesFromPayload(payload: Record<string, unknown> | null): unknown[] {
  if (!payload) return [];
  if (Array.isArray(payload.panes)) return payload.panes;
  return [];
}

/**
 * Official Herdr snapshot envelope is `{ result: { snapshot: { workspaces, panes, ... } } }`.
 * Older/flat shapes put workspaces directly on `result` (or the root). Accept both.
 */
export function extractSnapshotPayload(json: unknown): {
  workspaces: unknown[];
  panes: unknown[];
} {
  const root = asRecord(json);
  const result = asRecord(root?.result) ?? root;
  const nested = asRecord(result?.snapshot);
  const payload = nested ?? result;
  return {
    workspaces: workspacesFromPayload(payload),
    panes: panesFromPayload(payload),
  };
}

export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  const listed = await herdr(["workspace", "list"]);
  if (!listed.ok) throw new Error(herdrErrorMessage(listed));
  const root = asRecord(listed.json);
  const result = asRecord(root?.result);
  const workspaces = workspacesFromPayload(result);
  const out: WorkspaceInfo[] = [];
  for (const item of workspaces) {
    const record = asRecord(item);
    if (!record) continue;
    const workspace = workspaceFromRecord(record);
    if (workspace) out.push(workspace);
  }
  return out;
}

export async function snapshotWorkspacesAndPanes(): Promise<{
  workspaces: WorkspaceInfo[];
  paneCwds: Array<{ workspace_id: string; cwd: string | null }>;
}> {
  const snap = await herdr(["api", "snapshot"]);
  if (!snap.ok) {
    return { workspaces: await listWorkspaces(), paneCwds: [] };
  }
  const { workspaces: workspacesRaw, panes: panesRaw } = extractSnapshotPayload(snap.json);
  const workspaces: WorkspaceInfo[] = [];
  for (const item of workspacesRaw) {
    const record = asRecord(item);
    if (!record) continue;
    const workspace = workspaceFromRecord(record);
    if (workspace) workspaces.push(workspace);
  }
  const paneCwds: Array<{ workspace_id: string; cwd: string | null }> = [];
  for (const item of panesRaw) {
    const pane = asRecord(item);
    if (!pane || typeof pane.workspace_id !== "string") continue;
    const cwd =
      typeof pane.cwd === "string"
        ? pane.cwd
        : typeof pane.foreground_cwd === "string"
          ? pane.foreground_cwd
          : null;
    paneCwds.push({ workspace_id: pane.workspace_id, cwd });
  }
  return { workspaces, paneCwds };
}

/**
 * Resolve a workspace for an absolute target cwd.
 * Never uses the focused workspace implicitly: creates one with --no-focus when absent.
 */
export async function ensureWorkspaceForCwd(cwd: string): Promise<WorkspaceInfo> {
  const target = canonicalizePath(cwd);
  const { workspaces, paneCwds } = await snapshotWorkspacesAndPanes();

  for (const workspace of workspaces) {
    const candidates = [workspace.cwd, workspace.checkout_path].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (candidates.some((candidate) => pathsEqual(candidate, target))) {
      return { ...workspace, cwd: target };
    }
  }

  for (const pane of paneCwds) {
    if (pane.cwd && pathsEqual(pane.cwd, target)) {
      const match = workspaces.find((item) => item.workspace_id === pane.workspace_id);
      if (match) return { ...match, cwd: target };
      return { workspace_id: pane.workspace_id, cwd: target };
    }
  }

  // Also consult workspace list in case snapshot omitted cwd-bearing panes.
  if (workspaces.length === 0) {
    const listed = await listWorkspaces();
    for (const workspace of listed) {
      const candidates = [workspace.cwd, workspace.checkout_path].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (candidates.some((candidate) => pathsEqual(candidate, target))) {
        return { ...workspace, cwd: target };
      }
    }
  }

  const label = `auto-cwd:${target.split("/").filter(Boolean).slice(-2).join("/") || "root"}`;
  const created = await herdr([
    "workspace",
    "create",
    "--cwd",
    target,
    "--label",
    label.slice(0, 48),
    "--no-focus",
  ]);
  if (!created.ok) throw new Error(herdrErrorMessage(created));
  const root = asRecord(created.json);
  const result = asRecord(root?.result);
  const workspace = asRecord(result?.workspace) ?? asRecord(result);
  if (!workspace || typeof workspace.workspace_id !== "string") {
    throw new Error("workspace.create returned no workspace_id");
  }
  return {
    workspace_id: workspace.workspace_id,
    label: typeof workspace.label === "string" ? workspace.label : label,
    cwd: target,
  };
}
