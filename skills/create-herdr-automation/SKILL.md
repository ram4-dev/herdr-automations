---
name: create-herdr-automation
description: Create, update, or delete automations in the active ram4.herdr-automations YAML safely. Use when the user asks to add/edit/remove a Herdr automation, cron/interval/event job, or change automations.yaml for the linked Automations plugin. Prefer this over editing the YAML ad hoc.
---

# Create Herdr Automation

Safely mutate the live `automations.yaml` for plugin `ram4.herdr-automations`, then reload and verify the worker.

## Hard rules

- Discover the active config with `herdr plugin config-dir ram4.herdr-automations` (file: `automations.yaml`). Do not invent paths under `~/.config` unless that command returns them.
- Read the current file before editing. Prefer a minimal diff (add/replace/remove one automation; keep unrelated entries and comments when practical).
- Every automation `cwd` must be an absolute path (`/`…). Never store Herdr workspace/tab/pane IDs.
- Respect schema constraints (see `references/schema.md`). Default new automations to `enabled: false` unless the user explicitly wants them enabled.
- Always backup before replace. Validate candidate YAML before replacing the live file when possible. Reload the worker; on invalid config restore the backup.
- Do not modify global Herdr config, keybindings, or unrelated plugins.
- `herdr plugin action invoke` is asynchronous: a `0` exit only means the command was enqueued. Always wait on the returned `log_id` via `herdr plugin log list` until `succeeded`/`failed` before trusting reload/status.
- Treat external writes (email, messages, calendar changes, publishing, payments, or similar connector actions) as approval-sensitive. Before enabling recurrence, warn that a one-time approval can let the first run succeed while a later run blocks at the permission prompt.
- Never broaden connector permissions silently. Obtain explicit user authorization before selecting a persistent approval such as `Always allow`, and scope it to the exact repeated action, identity, destination, and connector.
- For approval-sensitive agent actions, scheduler health or `lastStatus: succeeded` alone is insufficient. Inspect the agent pane/status for a permission prompt and verify at least the second scheduled execution completes autonomously before reporting recurrence as working.

## Workflow

Resolve the skill directory first (this file's folder), then call scripts by absolute path so cwd does not matter:

```bash
SKILL_DIR="$(cd "$(dirname "$0")" && pwd)"   # when running from a wrapper
# From an agent: set SKILL_DIR to the absolute path of this skill folder
# (directory that contains SKILL.md).
APPLY="$SKILL_DIR/scripts/apply_automations_yaml.py"
SCHEMA_REF="$SKILL_DIR/references/schema.md"
```

1. **Resolve paths**
   - `CONFIG_DIR=$(herdr plugin config-dir ram4.herdr-automations)`
   - `CONFIG="$CONFIG_DIR/automations.yaml"`
2. **Read** current YAML. If missing, seed from the plugin example (disabled defaults) rather than an empty invalid file.
3. **Plan** the smallest change (create / update fields / delete by `id`). Confirm ids match `^[a-z][a-z0-9_-]{0,63}$`.
   - If the action performs an external write, identify the connector, acting account, destination, and expected approval boundary.
   - Warn the user before enabling it that a one-time permission may block later runs. Ask for persistent permission only when recurrence requires it and the repeated action is narrowly scoped.
4. **Write a temporary candidate** (never edit the live file by hand mid-flight):

```bash
CANDIDATE="$(mktemp /tmp/automations.candidate.XXXXXX.yaml)"
# write the full intended YAML into "$CANDIDATE"
```

5. **Apply safely** with the bundled script (absolute path):

```bash
python3 "$APPLY" --write-file "$CANDIDATE"
# or:
python3 "$APPLY" --stdin < "$CANDIDATE"
```

The script: discovers config-dir (or `--config`), backs up, validates, atomically replaces, invokes reload, **polls** `plugin log list` until that `log_id` finishes, then invokes status the same way and parses the **action log stdout** (not the invoke wrapper). On failure it restores the backup and best-effort reloads.

6. **Verify configuration and worker**
   - Prefer the script result JSON (`reloaded: true`).
   - Optionally: `herdr plugin log list --plugin ram4.herdr-automations --limit 10`.
7. **Verify recurrence for approval-sensitive actions**
   - Observe the first execution and inspect its agent pane/status through Herdr.
   - If a connector approval appears, do not leave the run blocked or claim success. Explain the scope and obtain explicit user authorization before choosing persistent approval.
   - Observe the next scheduled execution. Require the external tool to report completion, the agent to return to `done`, and the scheduler to advance `nextRunAt` without another prompt.
   - If a second live execution would be slow, costly, destructive, or otherwise disproportionate, state that it remains unverified instead of claiming durable recurrence.
8. **Report** config path, backup path, what changed, reload/status log outcomes, the external-permission scope (if any), and whether a second autonomous run was verified. Remove `$CANDIDATE` when done.

## Manual fallback (if script unavailable)

1. `cp "$CONFIG" "$CONFIG.bak.$(date +%Y%m%d%H%M%S)"`
2. Write candidate to a temp file; validate structure (absolute `cwd`, unique ids, five-field cron / `Ns|Nm|Nh` interval).
3. Atomically replace `$CONFIG`.
4. `INV=$(herdr plugin action invoke ram4.herdr-automations.reload)` → read `result.log.log_id`.
5. Poll `herdr plugin log list --plugin ram4.herdr-automations --limit 30` until that log is `succeeded` or `failed` (timeout ~30s).
6. Repeat invoke+poll for `ram4.herdr-automations.status`; parse **log.stdout** JSON; require `local.workerHealthy` or a real worker `result` and no `configError`.
7. For approval-sensitive external writes, inspect the agent and verify the second autonomous scheduled execution as described above.
8. If anything fails, restore the backup and reload again (waiting on logs).

## Resources

- `scripts/apply_automations_yaml.py` — deterministic backup/validate/replace/reload-wait/status-wait/restore
- `references/schema.md` — compact field rules for YAML edits
