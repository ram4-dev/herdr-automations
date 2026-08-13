#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const text = readFileSync(join(root, "herdr-plugin.toml"), "utf8");

function required(pattern: RegExp, label: string): void {
  if (!pattern.test(text)) {
    throw new Error(`manifest missing ${label}`);
  }
}

required(/id\s*=\s*"ram4\.herdr-automations"/, "plugin id");
required(/min_herdr_version\s*=\s*"0\.8\.0"/, "min_herdr_version");
required(/platforms\s*=\s*\["linux",\s*"macos"\]/, "platforms");
required(/\[\[build\]\]/, "build step for herdr plugin install");
required(
  /command\s*=\s*\["bun",\s*"install",\s*"--frozen-lockfile"\]/,
  "reproducible bun install --frozen-lockfile build",
);
required(/\[\[startup\]\]/, "startup hook");
required(/ensure-worker/, "ensure-worker startup command");
required(/\[\[panes\]\]/, "pane entry");
required(/placement\s*=\s*"popup"/, "popup placement");
required(/id\s*=\s*"board"/, "board pane entrypoint");
required(/command\s*=\s*\["bun",\s*"run",\s*"src\/main\.ts",\s*"ui"\]/, "board pane ui command");
required(
  /id\s*=\s*"open"[\s\S]*?command\s*=\s*\["bun",\s*"run",\s*"src\/main\.ts",\s*"open"\]/,
  "open action requests popup via open command",
);

for (const action of [
  "open",
  "status",
  "reload",
  "pause",
  "resume",
  "run-now",
  "retry",
  "cancel",
  "enable",
  "disable",
]) {
  required(new RegExp(`id\\s*=\\s*"${action}"`), `action ${action}`);
}

console.log(JSON.stringify({ ok: true, pluginId: "ram4.herdr-automations" }, null, 2));
