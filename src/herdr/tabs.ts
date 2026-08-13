import { TAB_LABEL_PREFIX } from "../constants.ts";
import { herdr, herdrErrorMessage } from "./cli.ts";
import { ensureWorkspaceForCwd } from "./workspaces.ts";

export type TabInfo = {
  tab_id: string;
  label?: string | null;
  workspace_id?: string;
  root_pane_id?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function extractTab(resultJson: unknown): TabInfo | null {
  const root = asRecord(resultJson);
  const result = asRecord(root?.result);
  const tab = asRecord(result?.tab) ?? asRecord(result);
  if (!tab) return null;
  const tabId = typeof tab.tab_id === "string" ? tab.tab_id : null;
  if (!tabId) return null;
  const rootPane = asRecord(result?.root_pane) ?? asRecord(tab.root_pane) ?? null;
  return {
    tab_id: tabId,
    label: typeof tab.label === "string" ? tab.label : null,
    workspace_id: typeof tab.workspace_id === "string" ? tab.workspace_id : undefined,
    root_pane_id:
      typeof rootPane?.pane_id === "string"
        ? rootPane.pane_id
        : typeof tab.root_pane_id === "string"
          ? tab.root_pane_id
          : undefined,
  };
}

export function automationTabLabel(automationId: string): string {
  return `${TAB_LABEL_PREFIX}${automationId}`;
}

export async function listTabs(workspaceId: string): Promise<TabInfo[]> {
  const result = await herdr(["tab", "list", "--workspace", workspaceId]);
  if (!result.ok) throw new Error(herdrErrorMessage(result));
  const root = asRecord(result.json);
  const payload = asRecord(root?.result);
  const tabs = payload?.tabs;
  if (!Array.isArray(tabs)) return [];
  const out: TabInfo[] = [];
  for (const item of tabs) {
    const tab = asRecord(item);
    if (!tab || typeof tab.tab_id !== "string") continue;
    out.push({
      tab_id: tab.tab_id,
      label: typeof tab.label === "string" ? tab.label : null,
      workspace_id: typeof tab.workspace_id === "string" ? tab.workspace_id : workspaceId,
      root_pane_id: typeof tab.root_pane_id === "string" ? tab.root_pane_id : undefined,
    });
  }
  return out;
}

/**
 * Resolve target by absolute cwd → workspace (create with --no-focus if needed),
 * then ensure reusable tab `auto:<id>` inside that workspace only.
 */
export async function ensureAutomationTab(input: {
  automationId: string;
  cwd: string;
  workspaceId?: string;
}): Promise<TabInfo> {
  const workspaceId = input.workspaceId ?? (await ensureWorkspaceForCwd(input.cwd)).workspace_id;
  const label = automationTabLabel(input.automationId);
  const existing = await listTabs(workspaceId);
  const found = existing.find((tab) => tab.label === label);
  if (found) {
    if (!found.root_pane_id) {
      const got = await herdr(["tab", "get", found.tab_id]);
      const detailed = extractTab(got.json);
      if (detailed?.root_pane_id) {
        return { ...detailed, workspace_id: detailed.workspace_id ?? workspaceId };
      }
    }
    return { ...found, workspace_id: found.workspace_id ?? workspaceId };
  }

  const created = await herdr([
    "tab",
    "create",
    "--workspace",
    workspaceId,
    "--label",
    label,
    "--cwd",
    input.cwd,
    "--no-focus",
  ]);
  if (!created.ok) throw new Error(herdrErrorMessage(created));
  const tab = extractTab(created.json);
  if (!tab) throw new Error("tab.create returned no tab");
  return { ...tab, workspace_id: tab.workspace_id ?? workspaceId };
}

export async function resolveRootPaneId(tab: TabInfo): Promise<string> {
  if (tab.root_pane_id) return tab.root_pane_id;
  const got = await herdr(["tab", "get", tab.tab_id]);
  if (!got.ok) throw new Error(herdrErrorMessage(got));
  const detailed = extractTab(got.json);
  if (!detailed?.root_pane_id) {
    const workspaceId = detailed?.workspace_id ?? tab.workspace_id;
    const panes = await herdr(
      workspaceId ? ["pane", "list", "--workspace", workspaceId] : ["pane", "list"],
    );
    const root = asRecord(panes.json);
    const result = asRecord(root?.result);
    const list = Array.isArray(result?.panes) ? result.panes : [];
    for (const item of list) {
      const pane = asRecord(item);
      if (!pane) continue;
      if (pane.tab_id === tab.tab_id && typeof pane.pane_id === "string") {
        return pane.pane_id;
      }
    }
    throw new Error(`could not resolve root pane for tab ${tab.tab_id}`);
  }
  return detailed.root_pane_id;
}
