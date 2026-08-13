import { BOARD_PANE_ENTRYPOINT, PLUGIN_ID } from "../constants.ts";
import { herdr, herdrErrorMessage } from "./cli.ts";

/** Argv for opening the Automations popup board (matches notify-center pattern). */
export function pluginPaneOpenArgs(
  pluginId = PLUGIN_ID,
  entrypoint = BOARD_PANE_ENTRYPOINT,
): string[] {
  return [
    "plugin",
    "pane",
    "open",
    "--plugin",
    pluginId,
    "--entrypoint",
    entrypoint,
    "--placement",
    "popup",
  ];
}

/**
 * Open the declared [[panes]] popup board in the Herdr session.
 * Plugin actions run non-interactively; they must request the pane rather than
 * running the TUI in the action process (which only reaches the plugin log).
 */
export async function openAutomationsPopup(): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await herdr(pluginPaneOpenArgs());
  if (!result.ok) {
    return { ok: false, error: herdrErrorMessage(result) };
  }
  return { ok: true };
}
