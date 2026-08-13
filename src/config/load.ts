import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { configPath } from "../util/paths.ts";
import {
  resolveAutomation,
  rootConfigSchema,
  type ResolvedAutomation,
  type RootConfig,
} from "./schema.ts";

export type ConfigLoadResult =
  | { ok: true; config: RootConfig; automations: ResolvedAutomation[]; path: string }
  | { ok: false; error: string; path: string; raw?: string };

export function exampleConfigYaml(): string {
  return `# Herdr Automations — example config
# Copy to $HERDR_PLUGIN_CONFIG_DIR/automations.yaml and edit.
# cwd must be absolute. Do not store Herdr workspace/tab/pane IDs.

version: 1

defaults:
  timezone: America/Argentina/Buenos_Aires
  overlap: skip          # if a run is still active, skip the new occurrence
  catch_up: latest       # on restart, at most the latest missed time occurrence
  timeout_seconds: 1800

automations:
  # All seeded examples are disabled — enable explicitly after review.
  # Cron: five fields (minute hour day month weekday) + timezone
  - id: weekday-echo
    name: Weekday echo
    enabled: false
    cwd: /tmp
    trigger:
      type: cron
      expr: "0 9 * * 1-5"
      timezone: America/Argentina/Buenos_Aires
    action:
      type: command
      command: ["echo", "weekday automation"]
      timeout_seconds: 60

  # Interval: Ns / Nm / Nh
  - id: every-30m-status
    enabled: false
    cwd: /tmp
    trigger:
      type: interval
      every: 30m
    action:
      type: command
      command: ["uname", "-a"]

  # Herdr event with equality match filters (no replay on restart)
  - id: on-agent-blocked
    enabled: false
    cwd: /tmp
    trigger:
      type: event
      event: pane.agent_status_changed
      match:
        agent_status: blocked
    action:
      type: agent
      kind: codex
      name: auto-blocker
      prompt: "A Herdr agent became blocked. Summarize likely next steps."
      timeout_seconds: 1800
`;
}

export function loadConfigFromText(text: string, path = configPath()): ConfigLoadResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (error) {
    return {
      ok: false,
      path,
      raw: text,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const result = rootConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, path, raw: text, error: details };
  }

  const ids = new Set<string>();
  for (const automation of result.data.automations) {
    if (ids.has(automation.id)) {
      return {
        ok: false,
        path,
        raw: text,
        error: `duplicate automation id "${automation.id}"`,
      };
    }
    ids.add(automation.id);
  }

  const automations = result.data.automations.map((item) =>
    resolveAutomation(item, result.data.defaults),
  );
  return { ok: true, config: result.data, automations, path };
}

export function loadConfigFile(path = configPath()): ConfigLoadResult {
  if (!existsSync(path)) {
    return {
      ok: false,
      path,
      error: `config file not found: ${path}`,
    };
  }
  const text = readFileSync(path, "utf8");
  return loadConfigFromText(text, path);
}
