# Unit tests for Windows startup registration. Fake registry only;
# the real registry is never touched.

import sys
from pathlib import Path

import astral_relay.agent.startup as startup_mod
from astral_relay.agent.startup import RUN_KEY, VALUE_NAME, ensure_autorun


class FakeWinreg:
    HKEY_CURRENT_USER = "HKCU"
    KEY_READ = 1
    KEY_SET_VALUE = 2
    REG_SZ = 3

    def __init__(self, values=None, fail_on_write=False):
        self.values = dict(values or {})
        self.fail_on_write = fail_on_write
        self.writes = []

    class _Key:
        def __init__(self, parent):
            self.parent = parent

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def OpenKey(self, root, path, reserved=0, access=0):
        assert root == self.HKEY_CURRENT_USER and path == RUN_KEY
        if access == self.KEY_SET_VALUE and self.fail_on_write:
            raise OSError("denied")
        return self._Key(self)

    def QueryValueEx(self, key, name):
        if name not in self.values:
            raise OSError("missing")
        return self.values[name], self.REG_SZ

    def SetValueEx(self, key, name, reserved, kind, value):
        self.values[name] = value
        self.writes.append((name, value))


def test_skipped_when_not_frozen(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    assert ensure_autorun("C:\\app.exe") == "skipped"


def test_added_current_updated(monkeypatch):
    import sys as sys_mod

    monkeypatch.setattr(sys_mod, "frozen", True, raising=False)
    fake = FakeWinreg()
    monkeypatch.setitem(sys_mod.modules, "winreg", fake)
    assert ensure_autorun("C:\\app.exe") == "added"
    assert fake.values[VALUE_NAME] == '"C:\\app.exe"'
    assert ensure_autorun("C:\\app.exe") == "current"
    assert ensure_autorun("D:\\new.exe") == "updated"
    assert fake.values[VALUE_NAME] == '"D:\\new.exe"'


def test_terminate_holders_contract():
    from astral_relay.agent.startup import terminate_holders

    assert terminate_holders("definitely-not-here-xyz.exe") == 0
    assert isinstance(terminate_holders(""), int)


def test_publish_kills_holders_then_succeeds(tmp_path, monkeypatch):
    import astral_relay.builder.build as build_mod

    calls = []
    monkeypatch.setattr(
        "astral_relay.agent.startup.terminate_holders",
        lambda path: calls.append(path) or 1,
    )
    real_sleep = build_mod.time.sleep
    monkeypatch.setattr(build_mod.time, "sleep", lambda s: None)
    temp_exe = tmp_path / "new.exe"
    temp_exe.write_bytes(b"NEW")
    output_exe = tmp_path / "out.exe"
    output_exe.write_bytes(b"OLD")
    attempts = {"n": 0}
    real_replace = build_mod.os.replace

    def flaky_replace(src, dst):
        attempts["n"] += 1
        if attempts["n"] < 5:
            raise PermissionError("locked")
        return real_replace(src, dst)

    monkeypatch.setattr(build_mod.os, "replace", flaky_replace)
    try:
        build_mod._publish_with_retry(temp_exe, output_exe, lambda msg: None)
    finally:
        monkeypatch.setattr(build_mod.os, "replace", real_replace)
        monkeypatch.setattr(build_mod.time, "sleep", real_sleep)
    assert output_exe.read_bytes() == b"NEW"
    assert len(calls) == 1


def test_failed_without_raise(monkeypatch):
    import sys as sys_mod

    monkeypatch.setattr(sys_mod, "frozen", True, raising=False)
    fake = FakeWinreg(fail_on_write=True)
    monkeypatch.setitem(sys_mod.modules, "winreg", fake)
    assert ensure_autorun("C:\\app.exe") == "failed"


def test_backup_install_current_repair(tmp_path, monkeypatch):
    import sys as sys_mod

    from astral_relay.agent.startup import backup_paths, ensure_backup_copy

    monkeypatch.setattr(sys_mod, "frozen", True, raising=False)
    src = tmp_path / "src.exe"
    src.write_bytes(b"MZ" + b"\x00" * 100)
    monkeypatch.setattr(sys_mod, "executable", str(src))
    monkeypatch.setenv("APPDATA", str(tmp_path / "roam"))
    status, path = ensure_backup_copy()
    assert status == "installed"
    assert path is not None and open(path, "rb").read() == src.read_bytes()
    assert ensure_backup_copy()[0] == "current"
    Path(path).write_bytes(b"broken")
    status, _ = ensure_backup_copy()
    assert status == "repaired"
    assert open(path, "rb").read() == src.read_bytes()
    directory, _ = backup_paths()
    assert list(directory.glob(".backup-tmp-*.exe")) == []


def test_backup_skipped_when_not_frozen(monkeypatch):
    import sys as sys_mod

    from astral_relay.agent.startup import ensure_backup_copy

    monkeypatch.delattr(sys_mod, "frozen", raising=False)
    assert ensure_backup_copy() == ("skipped", None)


def test_logon_task_registers_once(monkeypatch):
    import subprocess as subprocess_mod

    from astral_relay.agent.startup import ensure_logon_task

    calls = []

    class Proc:
        def __init__(self, code):
            self.returncode = code

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        if any("query" in part for part in cmd):
            return Proc(1)
        return Proc(0)

    monkeypatch.setattr(subprocess_mod, "run", fake_run)
    assert ensure_logon_task("C:\\a.exe") == "added"
    assert any("/create" in c for c in calls)

    def fake_run_exists(cmd, **kwargs):
        return Proc(0)

    monkeypatch.setattr(subprocess_mod, "run", fake_run_exists)
    assert ensure_logon_task("C:\\a.exe") == "current"

    def fake_run_boom(cmd, **kwargs):
        raise OSError("nope")

    monkeypatch.setattr(subprocess_mod, "run", fake_run_boom)
    assert ensure_logon_task("C:\\a.exe") == "failed"
