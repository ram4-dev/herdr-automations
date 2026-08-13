import { COMPLETION_SENTINEL_PREFIX } from "../constants.ts";
import type { ActionConfig } from "../config/schema.ts";
import { sanitizeError, sanitizeHistorySummary } from "../util/redaction.ts";
import { herdr, herdrErrorMessage } from "./cli.ts";
import { ensureAutomationTab, resolveRootPaneId } from "./tabs.ts";
import { ensureWorkspaceForCwd } from "./workspaces.ts";

export type RunExecutionResult = {
  status: "succeeded" | "failed";
  exitCode: number | null;
  summary: string;
  error: string | null;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Exported for unit tests. Keeps the reusable pane shell alive. */
export function commandToShell(command: string | string[], env: Record<string, string>): string {
  const exports = Object.entries(env)
    .map(([key, value]) => `export ${key}=${shellQuote(value)}`)
    .join("; ");
  const body = Array.isArray(command) ? command.map(shellQuote).join(" ") : command;
  const prefix = exports ? `${exports}; ` : "";
  // Emit sentinel with exit code but do not `exit` — that would kill the reusable pane shell.
  return `${prefix}${body}; __code=$?; echo "${COMPLETION_SENTINEL_PREFIX}$__code"`;
}

async function waitForCommandCompletion(
  paneId: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; matched: string | null }> {
  const pattern = `${COMPLETION_SENTINEL_PREFIX}(\\d+)`;
  const result = await herdr(
    [
      "pane",
      "wait-output",
      paneId,
      "--regex",
      pattern,
      "--timeout",
      String(timeoutMs),
      "--source",
      "recent-unwrapped",
    ],
    { timeoutMs: timeoutMs + 5_000 },
  );
  if (!result.ok) {
    return { exitCode: null, matched: null };
  }
  const text = result.stdout + result.stderr;
  const match = new RegExp(pattern).exec(text);
  if (!match?.[1]) {
    const root =
      result.json && typeof result.json === "object"
        ? (result.json as Record<string, unknown>)
        : null;
    const payload =
      root?.result && typeof root.result === "object"
        ? (root.result as Record<string, unknown>)
        : null;
    const matchedLine = typeof payload?.matched_line === "string" ? payload.matched_line : null;
    const fromLine = matchedLine ? new RegExp(pattern).exec(matchedLine) : null;
    return {
      exitCode: fromLine?.[1] ? Number(fromLine[1]) : null,
      matched: matchedLine,
    };
  }
  return { exitCode: Number(match[1]), matched: match[0] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

async function findReusableAgentInPane(
  name: string,
  paneId: string,
): Promise<{ name: string; pane_id: string } | null> {
  const listed = await herdr(["agent", "list"]);
  if (!listed.ok) return null;
  const root = asRecord(listed.json);
  const result = asRecord(root?.result);
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  for (const item of agents) {
    const agent = asRecord(item);
    if (!agent) continue;
    const agentName =
      typeof agent.name === "string"
        ? agent.name
        : typeof agent.agent_name === "string"
          ? agent.agent_name
          : null;
    const agentPane = typeof agent.pane_id === "string" ? agent.pane_id : null;
    if (agentName === name && agentPane === paneId) {
      return { name, pane_id: agentPane };
    }
  }
  return null;
}

async function agentNameExistsElsewhere(name: string, paneId: string): Promise<boolean> {
  const listed = await herdr(["agent", "list"]);
  if (!listed.ok) return false;
  const root = asRecord(listed.json);
  const result = asRecord(root?.result);
  const agents = Array.isArray(result?.agents) ? result.agents : [];
  for (const item of agents) {
    const agent = asRecord(item);
    if (!agent) continue;
    const agentName =
      typeof agent.name === "string"
        ? agent.name
        : typeof agent.agent_name === "string"
          ? agent.agent_name
          : null;
    const agentPane = typeof agent.pane_id === "string" ? agent.pane_id : null;
    if (agentName === name && agentPane !== paneId) return true;
  }
  return false;
}

export async function runCommandAction(input: {
  automationId: string;
  cwd: string;
  action: Extract<ActionConfig, { type: "command" }>;
  timeoutSeconds: number;
  workspaceId?: string;
}): Promise<RunExecutionResult> {
  try {
    const workspaceId = input.workspaceId ?? (await ensureWorkspaceForCwd(input.cwd)).workspace_id;
    const tab = await ensureAutomationTab({
      automationId: input.automationId,
      cwd: input.cwd,
      workspaceId,
    });
    const paneId = await resolveRootPaneId(tab);
    const shell = commandToShell(input.action.command, input.action.env ?? {});
    const run = await herdr(["pane", "run", paneId, shell], {
      timeoutMs: 15_000,
    });
    if (!run.ok) {
      return {
        status: "failed",
        exitCode: run.status,
        summary: sanitizeHistorySummary({ status: "failed", exitCode: run.status }),
        error: herdrErrorMessage(run),
      };
    }
    const completion = await waitForCommandCompletion(paneId, input.timeoutSeconds * 1000);
    if (completion.exitCode === null) {
      return {
        status: "failed",
        exitCode: null,
        summary: sanitizeHistorySummary({
          status: "failed",
          detail: "timeout or missing sentinel",
        }),
        error: "command completion sentinel not observed before timeout",
      };
    }
    const status = completion.exitCode === 0 ? "succeeded" : "failed";
    return {
      status,
      exitCode: completion.exitCode,
      summary: sanitizeHistorySummary({ status, exitCode: completion.exitCode }),
      error: status === "failed" ? `command exited ${completion.exitCode}` : null,
    };
  } catch (error) {
    return {
      status: "failed",
      exitCode: null,
      summary: sanitizeHistorySummary({ status: "failed", detail: sanitizeError(error) }),
      error: sanitizeError(error),
    };
  }
}

export async function runAgentAction(input: {
  automationId: string;
  cwd: string;
  action: Extract<ActionConfig, { type: "agent" }>;
  timeoutSeconds: number;
  workspaceId?: string;
}): Promise<RunExecutionResult> {
  try {
    const workspaceId = input.workspaceId ?? (await ensureWorkspaceForCwd(input.cwd)).workspace_id;
    const tab = await ensureAutomationTab({
      automationId: input.automationId,
      cwd: input.cwd,
      workspaceId,
    });
    const paneId = await resolveRootPaneId(tab);

    const existing = await findReusableAgentInPane(input.action.name, paneId);
    if (!existing) {
      if (await agentNameExistsElsewhere(input.action.name, paneId)) {
        return {
          status: "failed",
          exitCode: null,
          summary: sanitizeHistorySummary({
            status: "failed",
            detail: "agent name in use outside automation pane",
          }),
          error: `agent name "${input.action.name}" is already in use outside automation pane ${paneId}; refusing to reuse or prompt it`,
        };
      }
      const started = await herdr(
        [
          "agent",
          "start",
          input.action.name,
          "--kind",
          input.action.kind,
          "--pane",
          paneId,
          "--timeout",
          "60000",
        ],
        { timeoutMs: 70_000 },
      );
      if (!started.ok) {
        return {
          status: "failed",
          exitCode: started.status,
          summary: sanitizeHistorySummary({ status: "failed", detail: "agent start failed" }),
          error: herdrErrorMessage(started),
        };
      }
    }

    const prompted = await herdr(
      [
        "agent",
        "prompt",
        input.action.name,
        input.action.prompt,
        "--wait",
        "--timeout",
        String(input.timeoutSeconds * 1000),
      ],
      { timeoutMs: input.timeoutSeconds * 1000 + 10_000 },
    );
    if (!prompted.ok) {
      return {
        status: "failed",
        exitCode: prompted.status,
        summary: sanitizeHistorySummary({ status: "failed", detail: "agent prompt failed" }),
        error: herdrErrorMessage(prompted),
      };
    }
    return {
      status: "succeeded",
      exitCode: 0,
      summary: sanitizeHistorySummary({
        status: "succeeded",
        detail: `agent=${input.action.name} pane=${paneId}`,
      }),
      error: null,
    };
  } catch (error) {
    return {
      status: "failed",
      exitCode: null,
      summary: sanitizeHistorySummary({ status: "failed", detail: sanitizeError(error) }),
      error: sanitizeError(error),
    };
  }
}

export async function executeAction(input: {
  automationId: string;
  cwd: string;
  action: ActionConfig;
  timeoutSeconds: number;
  workspaceId?: string;
}): Promise<RunExecutionResult> {
  if (input.action.type === "command") {
    return runCommandAction({
      automationId: input.automationId,
      cwd: input.cwd,
      action: input.action,
      timeoutSeconds: input.timeoutSeconds,
      workspaceId: input.workspaceId,
    });
  }
  return runAgentAction({
    automationId: input.automationId,
    cwd: input.cwd,
    action: input.action,
    timeoutSeconds: input.timeoutSeconds,
    workspaceId: input.workspaceId,
  });
}
