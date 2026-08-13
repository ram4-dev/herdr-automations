import { describe, expect, test } from "bun:test";
import { extractSnapshotPayload } from "../../src/herdr/workspaces.ts";

describe("herdr api snapshot envelope", () => {
  test("reads official result.snapshot shape", () => {
    const extracted = extractSnapshotPayload({
      ok: true,
      result: {
        snapshot: {
          workspaces: [{ workspace_id: "w1", cwd: "/tmp/a" }],
          panes: [{ pane_id: "p1", workspace_id: "w1", cwd: "/tmp/a" }],
        },
      },
    });
    expect(extracted.workspaces).toHaveLength(1);
    expect(extracted.panes).toHaveLength(1);
  });

  test("falls back to flat result.workspaces shape", () => {
    const extracted = extractSnapshotPayload({
      ok: true,
      result: {
        workspaces: [{ workspace_id: "w2", cwd: "/tmp/b" }],
        panes: [],
      },
    });
    expect(extracted.workspaces).toHaveLength(1);
    expect((extracted.workspaces[0] as { workspace_id: string }).workspace_id).toBe("w2");
  });
});
