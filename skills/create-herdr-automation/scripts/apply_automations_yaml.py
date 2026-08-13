#!/usr/bin/env python3
"""Safely replace ram4.herdr-automations automations.yaml with backup/validate/reload/restore."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore

PLUGIN_ID = "ram4.herdr-automations"
ID_RE = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
AGENT_NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{0,31}$")
CRON_RE = re.compile(r"^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$")
DURATION_RE = re.compile(r"^(\d+)([smh])$")

DEFAULT_ACTION_TIMEOUT_S = 30.0
DEFAULT_POLL_INTERVAL_S = 0.1
LOG_LIST_LIMIT = 30


def herdr_bin() -> str:
    return os.environ.get("HERDR_BIN_PATH") or "herdr"


def action_timeout_s() -> float:
    raw = os.environ.get("HERDR_ACTION_TIMEOUT_S")
    if not raw:
        return DEFAULT_ACTION_TIMEOUT_S
    try:
        return max(0.5, float(raw))
    except ValueError:
        return DEFAULT_ACTION_TIMEOUT_S


def poll_interval_s() -> float:
    raw = os.environ.get("HERDR_ACTION_POLL_S")
    if not raw:
        return DEFAULT_POLL_INTERVAL_S
    try:
        return max(0.01, float(raw))
    except ValueError:
        return DEFAULT_POLL_INTERVAL_S


def run_herdr(args: list[str], timeout: float = 15.0) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [herdr_bin(), *args],
        check=False,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def parse_json_stdout(stdout: str, label: str) -> dict[str, Any]:
    text = stdout.strip()
    if not text:
        raise RuntimeError(f"{label}: empty stdout")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{label}: invalid JSON ({error}): {text[:300]}") from error
    if not isinstance(payload, dict):
        raise RuntimeError(f"{label}: expected JSON object")
    return payload


def discover_config_path(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    result = run_herdr(["plugin", "config-dir", PLUGIN_ID])
    if result.returncode != 0:
        raise RuntimeError(
            f"herdr plugin config-dir failed: {result.stderr.strip() or result.stdout.strip()}"
        )
    config_dir = Path(result.stdout.strip()).expanduser()
    if not config_dir.is_dir():
        raise RuntimeError(f"config dir does not exist: {config_dir}")
    return (config_dir / "automations.yaml").resolve()


def load_yaml_text(text: str) -> Any:
    if yaml is None:
        raise RuntimeError("PyYAML is required (pip install pyyaml)")
    return yaml.safe_load(text)


def validate_config(data: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(data, dict):
        return ["root must be a mapping"]
    if data.get("version") != 1:
        errors.append("version must be 1")
    automations = data.get("automations")
    if not isinstance(automations, list):
        errors.append("automations must be a list")
        return errors
    ids: set[str] = set()
    for index, item in enumerate(automations):
        prefix = f"automations[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{prefix}: must be a mapping")
            continue
        auto_id = item.get("id")
        if not isinstance(auto_id, str) or not ID_RE.match(auto_id):
            errors.append(f"{prefix}.id: invalid id")
        elif auto_id in ids:
            errors.append(f"{prefix}.id: duplicate id {auto_id}")
        else:
            ids.add(auto_id)
        cwd = item.get("cwd")
        if not isinstance(cwd, str) or not cwd.startswith("/"):
            errors.append(f"{prefix}.cwd: must be an absolute path")
        trigger = item.get("trigger")
        if not isinstance(trigger, dict) or "type" not in trigger:
            errors.append(f"{prefix}.trigger: required")
        else:
            ttype = trigger.get("type")
            if ttype == "cron":
                expr = trigger.get("expr")
                if not isinstance(expr, str) or not CRON_RE.match(expr):
                    errors.append(f"{prefix}.trigger.expr: need five cron fields")
            elif ttype == "interval":
                every = trigger.get("every")
                if not isinstance(every, str) or not DURATION_RE.match(every):
                    errors.append(f"{prefix}.trigger.every: use Ns/Nm/Nh")
            elif ttype == "event":
                if not isinstance(trigger.get("event"), str) or not trigger.get("event"):
                    errors.append(f"{prefix}.trigger.event: required")
            else:
                errors.append(f"{prefix}.trigger.type: unsupported")
        action = item.get("action")
        if not isinstance(action, dict) or "type" not in action:
            errors.append(f"{prefix}.action: required")
        else:
            atype = action.get("type")
            if atype == "command":
                cmd = action.get("command")
                if not (
                    (isinstance(cmd, str) and cmd)
                    or (isinstance(cmd, list) and cmd and all(isinstance(x, str) and x for x in cmd))
                ):
                    errors.append(f"{prefix}.action.command: non-empty string or string list")
            elif atype == "agent":
                name = action.get("name")
                if not isinstance(name, str) or not AGENT_NAME_RE.match(name):
                    errors.append(f"{prefix}.action.name: invalid agent name")
                if not isinstance(action.get("prompt"), str) or not action.get("prompt"):
                    errors.append(f"{prefix}.action.prompt: required")
                if not isinstance(action.get("kind"), str) or not action.get("kind"):
                    errors.append(f"{prefix}.action.kind: required")
            else:
                errors.append(f"{prefix}.action.type: must be command or agent")
    return errors


def backup_file(path: Path) -> Path | None:
    if not path.exists():
        return None
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = path.with_name(f"{path.name}.bak.{stamp}")
    shutil.copy2(path, backup)
    return backup


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=".automations.", suffix=".yaml", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as handle:
            handle.write(text)
            if not text.endswith("\n"):
                handle.write("\n")
        os.replace(tmp_path, path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink()
        raise


def extract_invoked_log_id(payload: dict[str, Any]) -> str:
    result = payload.get("result")
    candidates: list[Any] = []
    if isinstance(result, dict):
        candidates.append(result.get("log"))
        candidates.append(result)
    candidates.append(payload.get("log"))
    for candidate in candidates:
        if isinstance(candidate, dict) and isinstance(candidate.get("log_id"), str):
            return candidate["log_id"]
    raise RuntimeError(f"action invoke missing log_id: {json.dumps(payload)[:400]}")


def logs_from_list_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    result = payload.get("result")
    if isinstance(result, dict) and isinstance(result.get("logs"), list):
        return [item for item in result["logs"] if isinstance(item, dict)]
    if isinstance(payload.get("logs"), list):
        return [item for item in payload["logs"] if isinstance(item, dict)]
    return []


def invoke_action(action_id: str) -> str:
    """Start a plugin action and return its log_id. Does not wait for completion."""
    qualified = action_id if action_id.startswith(f"{PLUGIN_ID}.") else f"{PLUGIN_ID}.{action_id}"
    proc = run_herdr(["plugin", "action", "invoke", qualified])
    if proc.returncode != 0:
        raise RuntimeError(
            f"invoke {qualified} failed to enqueue: {proc.stderr.strip() or proc.stdout.strip()}"
        )
    payload = parse_json_stdout(proc.stdout, f"invoke {qualified}")
    return extract_invoked_log_id(payload)


def wait_for_log(
    log_id: str,
    *,
    timeout_s: float | None = None,
    poll_s: float | None = None,
    sleeper: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> dict[str, Any]:
    """Poll plugin log list until log_id is succeeded/failed or timeout."""
    timeout = action_timeout_s() if timeout_s is None else timeout_s
    interval = poll_interval_s() if poll_s is None else poll_s
    deadline = clock() + timeout
    last_status = "missing"
    while clock() < deadline:
        proc = run_herdr(
            [
                "plugin",
                "log",
                "list",
                "--plugin",
                PLUGIN_ID,
                "--limit",
                str(LOG_LIST_LIMIT),
            ]
        )
        if proc.returncode != 0:
            raise RuntimeError(
                f"plugin log list failed: {proc.stderr.strip() or proc.stdout.strip()}"
            )
        payload = parse_json_stdout(proc.stdout, "plugin log list")
        entry = next((item for item in logs_from_list_payload(payload) if item.get("log_id") == log_id), None)
        if entry is not None:
            status = str(entry.get("status") or "")
            last_status = status
            if status in {"succeeded", "failed"}:
                return entry
            if status not in {"running", ""}:
                raise RuntimeError(f"unexpected log status {status!r} for {log_id}")
        sleeper(interval)
    raise TimeoutError(
        f"timed out after {timeout:g}s waiting for log {log_id} (last_status={last_status})"
    )


def find_config_error(payload: dict[str, Any]) -> str | None:
    blocks: list[Any] = [payload, payload.get("result"), payload.get("local")]
    result = payload.get("result")
    if isinstance(result, dict):
        blocks.append(result.get("result"))
    local = payload.get("local")
    if isinstance(local, dict):
        blocks.append(local.get("config"))
        if isinstance(local.get("config"), dict):
            cfg = local["config"]
            if cfg.get("ok") is False and isinstance(cfg.get("error"), str):
                return cfg["error"]
    for block in blocks:
        if not isinstance(block, dict):
            continue
        err = block.get("configError")
        if isinstance(err, str) and err.strip():
            return err
    return None


def evaluate_reload_log(entry: dict[str, Any]) -> tuple[bool, str]:
    status = str(entry.get("status") or "")
    if status != "succeeded":
        detail = entry.get("error") or entry.get("stderr") or status
        return False, f"reload log {entry.get('log_id')} {detail}"
    exit_code = entry.get("exit_code")
    if exit_code not in (None, 0):
        return False, f"reload exit_code={exit_code}"
    stdout = (entry.get("stdout") or "").strip()
    if stdout:
        try:
            payload = json.loads(stdout)
        except json.JSONDecodeError:
            return True, "reload succeeded"
        if isinstance(payload, dict) and payload.get("ok") is False:
            return False, f"reload action error: {payload.get('error') or stdout[:200]}"
    return True, "reload succeeded"


def evaluate_status_log(entry: dict[str, Any]) -> tuple[bool, str]:
    status = str(entry.get("status") or "")
    if status != "succeeded":
        detail = entry.get("error") or entry.get("stderr") or status
        return False, f"status log {entry.get('log_id')} {detail}"
    exit_code = entry.get("exit_code")
    if exit_code not in (None, 0):
        return False, f"status exit_code={exit_code}"
    stdout = (entry.get("stdout") or "").strip()
    if not stdout:
        return False, "status log missing stdout"
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as error:
        return False, f"status stdout not JSON: {error}"
    if not isinstance(payload, dict):
        return False, "status stdout must be a JSON object"

    # Parse the action stdout (not the invoke wrapper).
    config_error = find_config_error(payload)
    if config_error:
        return False, f"configError after reload: {config_error}"

    local = payload.get("local") if isinstance(payload.get("local"), dict) else {}
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    worker_healthy = local.get("workerHealthy") is True
    real_result = isinstance(result.get("pid"), int) or isinstance(result.get("automations"), list)
    if not worker_healthy and not real_result:
        return False, "status missing workerHealthy and worker result"
    return True, "status ok"


def run_action_and_wait(action_id: str) -> dict[str, Any]:
    log_id = invoke_action(action_id)
    return wait_for_log(log_id)


def reload_and_check() -> tuple[bool, str]:
    try:
        reload_log = run_action_and_wait("reload")
    except (RuntimeError, TimeoutError) as error:
        return False, str(error)
    ok, detail = evaluate_reload_log(reload_log)
    if not ok:
        return False, detail

    try:
        status_log = run_action_and_wait("status")
    except (RuntimeError, TimeoutError) as error:
        return False, str(error)
    return evaluate_status_log(status_log)


def restore_backup(config_path: Path, backup: Path | None) -> None:
    if backup and backup.exists():
        shutil.copy2(backup, config_path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", help="Override path to automations.yaml")
    parser.add_argument("--stdin", action="store_true", help="Read candidate YAML from stdin")
    parser.add_argument("--write-file", help="Path to candidate YAML to apply")
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate candidate only; do not write/reload",
    )
    parser.add_argument(
        "--skip-reload",
        action="store_true",
        help="Write after validation but do not invoke herdr reload (tests)",
    )
    args = parser.parse_args(argv)

    if args.stdin == bool(args.write_file):
        print("provide exactly one of --stdin or --write-file", file=sys.stderr)
        return 2

    candidate = sys.stdin.read() if args.stdin else Path(args.write_file).read_text(encoding="utf8")
    try:
        data = load_yaml_text(candidate)
    except Exception as error:  # noqa: BLE001
        print(f"invalid YAML: {error}", file=sys.stderr)
        return 1
    errors = validate_config(data)
    if errors:
        print("validation failed:", file=sys.stderr)
        for item in errors:
            print(f"  - {item}", file=sys.stderr)
        return 1

    if args.validate_only:
        print(json.dumps({"ok": True, "validated": True}, indent=2))
        return 0

    config_path = discover_config_path(args.config)
    # Read-before-write discipline: refuse if existing file unreadable when present.
    if config_path.exists():
        config_path.read_text(encoding="utf8")

    backup = backup_file(config_path)
    try:
        atomic_write(config_path, candidate)
    except Exception as error:  # noqa: BLE001
        print(f"write failed: {error}", file=sys.stderr)
        return 1

    if args.skip_reload:
        print(
            json.dumps(
                {
                    "ok": True,
                    "config": str(config_path),
                    "backup": str(backup) if backup else None,
                    "reloaded": False,
                },
                indent=2,
            )
        )
        return 0

    ok, detail = reload_and_check()
    if not ok:
        restore_backup(config_path, backup)
        # Best-effort restore reload; still wait on its log so we do not race.
        try:
            restore_log = run_action_and_wait("reload")
            restore_ok, restore_detail = evaluate_reload_log(restore_log)
            restore_note = restore_detail if restore_ok else f"restore reload failed: {restore_detail}"
        except (RuntimeError, TimeoutError) as error:
            restore_note = f"restore reload wait failed: {error}"
        print(f"apply failed; restored backup. {detail} ({restore_note})", file=sys.stderr)
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "config": str(config_path),
                "backup": str(backup) if backup else None,
                "reloaded": True,
                "detail": detail,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
