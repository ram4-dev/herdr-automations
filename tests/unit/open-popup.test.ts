import { describe, expect, test } from "bun:test";
import { BOARD_PANE_ENTRYPOINT, PLUGIN_ID } from "../../src/constants.ts";
import { pluginPaneOpenArgs } from "../../src/herdr/open-popup.ts";

describe("open automations popup", () => {
  test("builds herdr plugin pane open for the board popup entrypoint", () => {
    expect(pluginPaneOpenArgs()).toEqual([
      "plugin",
      "pane",
      "open",
      "--plugin",
      PLUGIN_ID,
      "--entrypoint",
      BOARD_PANE_ENTRYPOINT,
      "--placement",
      "popup",
    ]);
    expect(BOARD_PANE_ENTRYPOINT).toBe("board");
  });
});
