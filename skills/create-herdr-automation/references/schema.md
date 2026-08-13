# automations.yaml (compact)

Plugin: `ram4.herdr-automations`  
Live file: `$(herdr plugin config-dir ram4.herdr-automations)/automations.yaml`  
Full JSON Schema in plugin repo: `schema/automations.schema.json`

## Root

```yaml
version: 1
defaults: # optional
  timezone: America/Argentina/Buenos_Aires
  overlap: skip
  catch_up: latest # or none
  timeout_seconds: 1800
automations: [] # required list
```

## Automation

| Field      | Rule                                 |
| ---------- | ------------------------------------ |
| `id`       | `^[a-z][a-z0-9_-]{0,63}$`, unique    |
| `cwd`      | absolute path (`/`…)                 |
| `enabled`  | bool; prefer `false` for new entries |
| `overlap`  | `skip` only                          |
| `catch_up` | `latest` \| `none`                   |
| `trigger`  | one of cron / interval / event       |
| `action`   | one of command / agent (not both)    |

### Triggers

- **cron**: `expr` five fields (`m h dom mon dow`); optional `timezone`
- **interval**: `every` like `30s`, `10m`, `2h`
- **event**: `event` string + optional equality `match` map

### Actions

- **command**: `command` string or argv list; optional `env`, `timeout_seconds`
- **agent**: `kind`, `name` (`^[a-z][a-z0-9_-]{0,31}$`), `prompt`; optional `timeout_seconds`

Never persist Herdr workspace/tab/pane IDs.
