#!/usr/bin/env python3
"""Deterministic tests for apply_automations_yaml.py (fake herdr; no real TTY)."""

from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("apply_automations_yaml.py")

VALID = """version: 1
automations:
  - id: demo-echo
    enabled: false
    cwd: /tmp
    trigger:
      type: interval
      every: 10m
    action:
      type: command
      command: ["echo", "ok"]
"""

INVALID_RELATIVE_CWD = """version: 1
automations:
  - id: bad
    cwd: relative/path
    trigger:
      type: interval
      every: 10m
    action:
      type: command
      command: ["true"]
"""

FAKE_HERDR = r'''#!/usr/bin/env python3
"""Fake herdr for async plugin action invoke + log list polling."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

STATE = Path(os.environ["FAKE_HERDR_STATE"])
MODE = os.environ.get("FAKE_HERDR_MODE", "delayed_ok")


def load() -> dict:
    if not STATE.exists():
        data = {"seq": 0, "logs": {}}
        STATE.write_text(json.dumps(data), encoding="utf8")
        return data
    return json.loads(STATE.read_text(encoding="utf8"))


def save(data: dict) -> None:
    STATE.write_text(json.dumps(data), encoding="utf8")


def ok(result: dict) -> None:
    sys.stdout.write(json.dumps({"ok": True, "result": result}) + "\n")


def fail(message: str, code: int = 1) -> None:
    sys.stderr.write(message + "\n")
    raise SystemExit(code)


def status_stdout(config_error: str | None = None) -> str:
    payload = {
        "ok": True,
        "result": {
            "pid": 4242,
            "paused": False,
            "configError": config_error,
            "activeRuns": 0,
            "automations": [],
        },
        "local": {
            "workerHealthy": True,
            "workerPid": 4242,
            "configError": config_error,
        },
    }
    return json.dumps(payload, indent=2)


def main() -> int:
    args = sys.argv[1:]
    data = load()

    if args[:2] == ["plugin", "config-dir"]:
        sys.stdout.write(str(Path(os.environ["FAKE_CONFIG_DIR"])) + "\n")
        return 0

    if args[:3] == ["plugin", "action", "invoke"]:
        action = args[3]
        data["seq"] += 1
        log_id = f"plugin-log-{data['seq']}"
        now = time.time()
        # Delay completion until enough list polls (simulates async enqueue).
        delay_polls = int(os.environ.get("FAKE_DELAY_POLLS", "2"))
        entry = {
            "log_id": log_id,
            "plugin_id": "ram4.herdr-automations",
            "action_id": action.split(".")[-1],
            "status": "running",
            "started_unix_ms": int(now * 1000),
            "finished_unix_ms": None,
            "exit_code": None,
            "stdout": None,
            "stderr": None,
            "error": None,
            "_polls": 0,
            "_delay": delay_polls,
            "_action": action,
        }
        data["logs"][log_id] = entry
        save(data)
        ok(
            {
                "type": "plugin_action_invoked",
                "log": {
                    "log_id": log_id,
                    "plugin_id": "ram4.herdr-automations",
                    "action_id": entry["action_id"],
                    "status": "running",
                    "started_unix_ms": entry["started_unix_ms"],
                },
                "action": {"action_id": entry["action_id"]},
            }
        )
        return 0

    if args[:3] == ["plugin", "log", "list"]:
        for entry in data["logs"].values():
            if entry["status"] != "running":
                continue
            entry["_polls"] += 1
            if entry["_polls"] < entry["_delay"]:
                continue
            action = entry["_action"]
            short = action.split(".")[-1]
            if MODE == "reload_fail" and short == "reload" and not entry.get("_is_restore"):
                # First reload fails; later restore reload succeeds.
                failed_count = data.get("failed_reloads", 0)
                if failed_count < 1:
                    data["failed_reloads"] = failed_count + 1
                    entry["status"] = "failed"
                    entry["exit_code"] = 1
                    entry["stderr"] = "reload boom"
                    entry["error"] = "reload boom"
                    entry["finished_unix_ms"] = int(time.time() * 1000)
                    continue
            if MODE == "status_config_error" and short == "status":
                entry["status"] = "succeeded"
                entry["exit_code"] = 0
                entry["stdout"] = status_stdout("invalid yaml: boom")
                entry["finished_unix_ms"] = int(time.time() * 1000)
                continue
            if short == "reload":
                entry["status"] = "succeeded"
                entry["exit_code"] = 0
                entry["stdout"] = json.dumps({"ok": True, "result": {"reloaded": True}}, indent=2)
                entry["finished_unix_ms"] = int(time.time() * 1000)
            elif short == "status":
                entry["status"] = "succeeded"
                entry["exit_code"] = 0
                entry["stdout"] = status_stdout(None)
                entry["finished_unix_ms"] = int(time.time() * 1000)
            else:
                entry["status"] = "succeeded"
                entry["exit_code"] = 0
                entry["stdout"] = "{}"
                entry["finished_unix_ms"] = int(time.time() * 1000)
        save(data)
        logs = sorted(data["logs"].values(), key=lambda item: item["started_unix_ms"], reverse=True)
        # Strip private keys from response
        public = []
        for item in logs:
            public.append({k: v for k, v in item.items() if not k.startswith("_")})
        ok({"type": "plugin_log_list", "logs": public})
        return 0

    fail(f"unsupported: {' '.join(args)}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
'''


class ApplyTests(unittest.TestCase):
    def test_validate_only_accepts_valid(self) -> None:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--validate-only", "--stdin"],
            input=VALID,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(json.loads(proc.stdout)["ok"])

    def test_validate_only_rejects_relative_cwd(self) -> None:
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--validate-only", "--stdin"],
            input=INVALID_RELATIVE_CWD,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 1)
        self.assertIn("absolute path", proc.stderr)

    def _fake_env(self, tmp: Path, mode: str) -> dict[str, str]:
        fake_bin = tmp / "herdr"
        fake_bin.write_text(FAKE_HERDR, encoding="utf8")
        fake_bin.chmod(fake_bin.stat().st_mode | stat.S_IXUSR)
        config_dir = tmp / "config"
        config_dir.mkdir()
        (config_dir / "automations.yaml").write_text(
            "version: 1\nautomations: []\n",
            encoding="utf8",
        )
        state = tmp / "fake-state.json"
        env = os.environ.copy()
        env.update(
            {
                "HERDR_BIN_PATH": str(fake_bin),
                "FAKE_HERDR_STATE": str(state),
                "FAKE_CONFIG_DIR": str(config_dir),
                "FAKE_HERDR_MODE": mode,
                "FAKE_DELAY_POLLS": "2",
                "HERDR_ACTION_TIMEOUT_S": "3",
                "HERDR_ACTION_POLL_S": "0.01",
            }
        )
        return env

    def test_delayed_success_waits_for_log_succeeded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_raw:
            tmp = Path(tmp_raw)
            env = self._fake_env(tmp, "delayed_ok")
            candidate = tmp / "candidate.yaml"
            candidate.write_text(VALID, encoding="utf8")
            config = Path(env["FAKE_CONFIG_DIR"]) / "automations.yaml"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--write-file",
                    str(candidate),
                ],
                text=True,
                capture_output=True,
                check=False,
                env=env,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            payload = json.loads(proc.stdout)
            self.assertTrue(payload["ok"])
            self.assertTrue(payload["reloaded"])
            self.assertIn("demo-echo", config.read_text(encoding="utf8"))
            # Ensure polling happened (delay polls > 1 means multiple list calls).
            state = json.loads(Path(env["FAKE_HERDR_STATE"]).read_text(encoding="utf8"))
            polls = [entry.get("_polls", 0) for entry in state["logs"].values()]
            self.assertTrue(any(p >= 2 for p in polls), state)

    def test_reload_failed_restores_backup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_raw:
            tmp = Path(tmp_raw)
            env = self._fake_env(tmp, "reload_fail")
            candidate = tmp / "candidate.yaml"
            candidate.write_text(VALID, encoding="utf8")
            config = Path(env["FAKE_CONFIG_DIR"]) / "automations.yaml"
            original = "version: 1\nautomations: []\n"
            config.write_text(original, encoding="utf8")
            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--write-file",
                    str(candidate),
                ],
                text=True,
                capture_output=True,
                check=False,
                env=env,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertIn("restored backup", proc.stderr)
            self.assertIn("reload", proc.stderr.lower())
            self.assertEqual(config.read_text(encoding="utf8"), original)

    def test_status_config_error_restores_backup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_raw:
            tmp = Path(tmp_raw)
            env = self._fake_env(tmp, "status_config_error")
            candidate = tmp / "candidate.yaml"
            candidate.write_text(VALID, encoding="utf8")
            config = Path(env["FAKE_CONFIG_DIR"]) / "automations.yaml"
            original = "version: 1\nautomations: []\n"
            config.write_text(original, encoding="utf8")
            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--write-file",
                    str(candidate),
                ],
                text=True,
                capture_output=True,
                check=False,
                env=env,
            )
            self.assertEqual(proc.returncode, 1)
            self.assertIn("configError", proc.stderr)
            self.assertIn("restored backup", proc.stderr)
            self.assertEqual(config.read_text(encoding="utf8"), original)

    def test_skip_reload_still_backs_up(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / "automations.yaml"
            config.write_text("version: 1\nautomations: []\n", encoding="utf8")
            candidate = Path(tmp) / "candidate.yaml"
            candidate.write_text(VALID, encoding="utf8")
            proc = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config),
                    "--write-file",
                    str(candidate),
                    "--skip-reload",
                ],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            payload = json.loads(proc.stdout)
            self.assertIsNotNone(payload["backup"])
            self.assertTrue(Path(payload["backup"]).exists())


if __name__ == "__main__":
    unittest.main()
