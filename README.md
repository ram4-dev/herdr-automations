# Herdr Automations

[![Herdr 0.8+](https://img.shields.io/badge/Herdr-0.8%2B-7c8cff)](https://herdr.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Declarative cron, interval, and Herdr-event automations for Herdr 0.8 (protocol 19), with a popup TUI and a durable out-of-process worker.

Plugin id: `ram4.herdr-automations`

## Trust and security

This plugin runs as your user with full access to the Herdr CLI/socket for the session that started it. Treat YAML `command` and `agent` actions like shell scripts you chose to run. Review `herdr-plugin.toml` and `automations.yaml` before linking or installing. History and logs redact common secret patterns and secret-looking env keys, but do not put credentials in prompts, commands, or YAML if you can avoid it.

This repository does not modify your active Herdr config when you clone it. Linking/enabling is an explicit local step.

## Requirements

- Herdr `>= 0.8.0`
- Bun `>= 1.3`
- macOS or Linux

SQLite uses Bun's built-in `bun:sqlite` (no native npm addon).

## Local development (safe)

```sh
cd herdr-automations
bun install
bun test
bun run typecheck
bun run lint
bun run validate:manifest
```

Do **not** link into your default session while experimenting unless you intend to. Prefer an isolated named Herdr session when you want a live smoke test:

```sh
herdr --session automations-dev plugin link "$PWD" --disabled
# inspect, then enable only inside that session/workflow when ready
```

Automated tests use a deterministic fake Herdr CLI/socket. They do not exercise your live default session.

## Install

From the Herdr marketplace / GitHub (recommended):

```sh
herdr plugin install ram4-dev/herdr-automations
```

`herdr plugin install` clones the plugin, runs the manifest `[[build]]` step
(`bun install --frozen-lockfile` against the committed `bun.lock`), then
registers it. If the build fails, install aborts and the plugin is not
registered. Requires `bun` on `PATH`.

### Local link (development)

`plugin link` does **not** run `[[build]]`; install dependencies yourself:

```sh
cd /path/to/herdr-automations
bun install --frozen-lockfile
herdr plugin link "$PWD"
```

Config and state directories:

```sh
herdr plugin config-dir ram4.herdr-automations
# YAML:  $HERDR_PLUGIN_CONFIG_DIR/automations.yaml
# SQLite: $HERDR_PLUGIN_STATE_DIR/automations.sqlite
```

Copy the annotated example:

```sh
cp examples/automations.yaml "$(herdr plugin config-dir ram4.herdr-automations)/automations.yaml"
```

Optional JSON Schema for editors: `schema/automations.schema.json`.

## Keybinding

```toml
[[keys.command]]
key = "prefix+shift+a"
type = "plugin_action"
command = "ram4.herdr-automations.open"
description = "open automations"
```

Apply with `herdr server reload-config` when you intentionally change your config.

## Actions / CLI

| Action               | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `open`               | Open the Automations **popup board** in the Herdr session (`herdr plugin pane open`) |
| `ui`                 | Interactive TUI process used by the `[[panes]] board` entrypoint                     |
| `status`             | JSON status                                                                          |
| `reload`             | Reload YAML into the running worker                                                  |
| `pause` / `resume`   | Pause or resume all automatic triggers                                               |
| `run-now`            | Manual run (`AUTOMATION_ID`, argv, or selected text)                                 |
| `retry`              | Retry latest failed/interrupted run                                                  |
| `cancel`             | Cancel latest queued run (not an executing run)                                      |
| `enable` / `disable` | Runtime enable override                                                              |

Invoke examples:

```sh
# Keybinding / action: opens the popup board (does not run the TUI in the action process).
herdr plugin action invoke ram4.herdr-automations.open
# Equivalent direct pane open:
herdr plugin pane open --plugin ram4.herdr-automations --entrypoint board --placement popup

herdr plugin action invoke ram4.herdr-automations.status
AUTOMATION_ID=weekday-morning herdr plugin action invoke ram4.herdr-automations.run-now
```

`open` must call `herdr plugin pane open` so Herdr hosts the interactive `board` pane.
Running `bun run src/main.ts ui` from a plugin action is non-interactive and only reaches the plugin log.

Or directly with Bun during development:

```sh
HERDR_PLUGIN_CONFIG_DIR=./.tmp/config \
HERDR_PLUGIN_STATE_DIR=./.tmp/state \
bun run src/main.ts status
```

## How it works

- A `[[startup]]` hook runs `ensure-worker`, which detaches a singleton worker if needed.
- The worker owns scheduling, durable occurrence claims, concurrency, and Herdr event subscription.
- Config is YAML; invalid reloads keep the last valid runtime config and surface the validation error.
- Seeded/example automations are all `enabled: false`. Fresh installs schedule the next future occurrence only and never execute catch-up history.
- Targets resolve by absolute `cwd` to a workspace (created with `--no-focus` when absent); reusable tabs `auto:<id>` are created inside that workspace only.
- Commands run visibly and emit a completion sentinel without `exit`ing the reusable pane shell. Agents use `herdr agent start` then `herdr agent prompt --wait`, reusing a named agent only when it already lives in the automation pane.
- Per-automation serialization, global concurrency 2, overlap policy `skip`.
- On restart, catch-up `latest` runs only when durable prior schedule state exists; at most one missed time occurrence; events are never replayed. Abandoned runs become `interrupted_unknown` and need manual retry.

## TUI

The popup lists status, trigger, next run, and last result. Keys:

- `r` reload YAML
- `p` pause/resume all
- `e` enable/disable selected
- `n` run now
- `c` cancel latest queued run (executing runs return a clear not-controllable error)
- `t` retry
- `h` history/diagnostics
- `o` open YAML in `$EDITOR` (create/edit/delete for v1). The TUI fully suspends (refresh, raw mode, key listener) while the editor runs; config reloads only if the editor exits 0.
- `?` help
- `q` / `Esc` quit

Cancel only affects identifiable queued runs. Once a run is executing, cancel refuses rather than sending unsafe interrupts.

v1 does not fake unsupported in-TUI create/edit forms; structural edits go through the external editor.

## Agent skill (optional)

Bundled skill for safe YAML mutations: `skills/create-herdr-automation` (`$create-herdr-automation`). Install into your Codex skills directory after review; it is not auto-linked from this repo.

## License

MIT
