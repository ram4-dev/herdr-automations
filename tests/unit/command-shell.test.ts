import { describe, expect, test } from "bun:test";
import { commandToShell } from "../../src/herdr/runners.ts";

describe("commandToShell", () => {
  test("emits sentinel without exiting the reusable shell", () => {
    const shell = commandToShell(["echo", "hi"], { FOO: "bar" });
    expect(shell).toContain("HERDR_AUTOMATION_DONE:");
    expect(shell).toContain("__code=$?");
    expect(/\bexit\b/.test(shell)).toBe(false);
  });
});
