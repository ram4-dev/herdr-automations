#!/usr/bin/env bun
import {
  actionCancel,
  actionDiagnostics,
  actionDisable,
  actionEnable,
  actionOpen,
  actionOpenConfig,
  actionPause,
  actionReload,
  actionResume,
  actionRetry,
  actionRunNow,
  actionStatus,
} from "./cli/actions.ts";
import { runTui } from "./tui/app.ts";
import { ensureWorker } from "./worker/ensure.ts";
import { runWorker } from "./worker/main.ts";

async function main(): Promise<number> {
  const command = process.argv[2] ?? "help";

  switch (command) {
    case "ensure-worker": {
      const result = await ensureWorker();
      console.log(JSON.stringify({ ok: true, result }, null, 2));
      return 0;
    }
    case "worker":
      await runWorker();
      return 0;
    case "open":
      // Keybinding / plugin action: open the popup board pane in the Herdr session.
      return await actionOpen();
    case "ui":
      // [[panes]] board entrypoint — interactive TUI inside the popup.
      return await runTui();
    case "status":
      return await actionStatus();
    case "reload":
      return await actionReload();
    case "pause":
      return await actionPause();
    case "resume":
      return await actionResume();
    case "run-now":
      return await actionRunNow();
    case "retry":
      return await actionRetry();
    case "cancel":
      return await actionCancel();
    case "enable":
      return await actionEnable();
    case "disable":
      return await actionDisable();
    case "open-config":
      return await actionOpenConfig();
    case "diagnostics":
      return await actionDiagnostics();
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`unknown command: ${command}`);
      printHelp();
      return 2;
  }
}

function printHelp(): void {
  console.log(`herdr-automations

Commands:
  ensure-worker   Start detached singleton worker if needed (startup hook)
  worker          Run worker in foreground
  open            Open the Automations popup board (herdr plugin pane open)
  ui              Run the interactive TUI (used by the [[panes]] board entrypoint)
  status          JSON status
  reload          Reload YAML
  pause|resume    Pause/resume all automatic triggers
  run-now [id]    Queue a manual run
  retry [id]      Retry latest failed/interrupted run
  cancel [id]     Cancel latest queued run (not executing)
  enable [id]     Enable automation (runtime override)
  disable [id]    Disable automation (runtime override)
  open-config     Edit automations.yaml in $EDITOR
  diagnostics     Local SQLite diagnostics
`);
}

const code = await main();
process.exit(code);
