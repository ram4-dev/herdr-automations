import { describe, expect, test } from "bun:test";
import { eventMatches, normalizeHerdrEvent } from "../../src/triggers/events.ts";

describe("herdr event envelope normalization", () => {
  test("match agent_status blocked from message.data", () => {
    const envelope = {
      type: "pane.agent_status_changed",
      id: "e1",
      data: { agent_status: "blocked", pane_id: "w1:p1" },
    };
    const normalized = normalizeHerdrEvent(envelope);
    expect(normalized.event).toBe("pane.agent_status_changed");
    expect(normalized.data.agent_status).toBe("blocked");
    expect(eventMatches({ agent_status: "blocked" }, envelope)).toBe(true);
    expect(eventMatches({ agent_status: "done" }, envelope)).toBe(false);
  });
});
