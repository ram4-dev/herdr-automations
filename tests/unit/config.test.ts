import { describe, expect, test } from "bun:test";
import { exampleConfigYaml, loadConfigFromText } from "../../src/config/load.ts";

describe("yaml/schema", () => {
  test("accepts annotated example", () => {
    const loaded = loadConfigFromText(exampleConfigYaml());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.config.version).toBe(1);
    expect(loaded.config.defaults.timezone).toBe("America/Argentina/Buenos_Aires");
    expect(loaded.automations.length).toBeGreaterThan(0);
  });

  test("rejects relative cwd", () => {
    const loaded = loadConfigFromText(`
version: 1
automations:
  - id: bad
    cwd: relative/path
    trigger: { type: interval, every: 5m }
    action: { type: command, command: ["true"] }
`);
    expect(loaded.ok).toBe(false);
  });

  test("rejects four-field cron", () => {
    const loaded = loadConfigFromText(`
version: 1
automations:
  - id: badcron
    cwd: /tmp
    trigger: { type: cron, expr: "0 9 * *" }
    action: { type: command, command: ["true"] }
`);
    expect(loaded.ok).toBe(false);
  });

  test("rejects duplicate ids", () => {
    const loaded = loadConfigFromText(`
version: 1
automations:
  - id: same
    cwd: /tmp
    trigger: { type: interval, every: 1m }
    action: { type: command, command: ["true"] }
  - id: same
    cwd: /tmp
    trigger: { type: interval, every: 2m }
    action: { type: command, command: ["true"] }
`);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error).toContain("duplicate");
  });
});
