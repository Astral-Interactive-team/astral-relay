# Unit tests for Windows app discovery and launch safeguards.
# Mirrors tests/apps.test.js using synthetic shortcut bytes plus temp dirs.

import base64
import struct

import pytest

from astral_relay.agent.windows import apps as apps_mod
from astral_relay.agent.windows.apps import (
    discover_catalog,
    format_apps_list,
    launch_app,
    needs_native_resolve,
    parse_lnk_target,
    resolve_by_id,
    search_catalog,
    stable_id,
    to_autocomplete_choices,
)


def _unicode_lnk(target: str) -> bytes:
    encoded = target.encode("utf-16-le") + b"\x00\x00"
    base_offset = 40
    info_size = base_offset + len(encoded)
    buf = bytearray(76 + info_size)
    struct.pack_into("<I", buf, 0, 0x4C)
    struct.pack_into("<I", buf, 20, 0x02)
    pos = 76
    struct.pack_into("<I", buf, pos, info_size)
    struct.pack_into("<I", buf, pos + 4, 36)
    struct.pack_into("<I", buf, pos + 8, 0x01)
    struct.pack_into("<I", buf, pos + 16, 0)
    struct.pack_into("<I", buf, pos + 28, base_offset)
    struct.pack_into("<I", buf, pos + 32, 0)
    buf[pos + base_offset : pos + base_offset + len(encoded)] = encoded
    return bytes(buf)


def _ansi_only_lnk() -> bytes:
    buf = bytearray(76 + 32)
    struct.pack_into("<I", buf, 0, 0x4C)
    struct.pack_into("<I", buf, 20, 0x02)
    pos = 76
    struct.pack_into("<I", buf, pos, 32)
    struct.pack_into("<I", buf, pos + 4, 28)
    struct.pack_into("<I", buf, pos + 8, 0x01)
    struct.pack_into("<I", buf, pos + 16, 28)
    return bytes(buf)


def test_reads_unicode_target():
    assert parse_lnk_target(_unicode_lnk("C:\\Tools\\app.exe")) == "C:\\Tools\\app.exe"


def test_returns_null_for_ansi_only_and_garbage():
    assert parse_lnk_target(_ansi_only_lnk()) is None
    assert parse_lnk_target(b"junk") is None
    assert parse_lnk_target(b"") is None


def test_flags_ansi_only():
    assert needs_native_resolve(_ansi_only_lnk()) is True
    assert needs_native_resolve(_unicode_lnk("C:\\Tools\\app.exe")) is False
    assert needs_native_resolve(b"junk") is False


def test_resolve_ansi_maps_base64_lines():
    def fake(paths):
        lines = []
        for path in paths:
            a = base64.b64encode(path.encode()).decode()
            b = base64.b64encode("C:\\Tools\\app.exe".encode()).decode()
            lines.append(f"{a} {b}")
        return "\n".join(lines) + "\n"

    assert apps_mod.resolve_ansi_targets(["C:\\x\\a.lnk"], spawn_fn=fake) == {"C:\\x\\a.lnk": "C:\\Tools\\app.exe"}
    assert apps_mod.resolve_ansi_targets([], spawn_fn=fake) == {}
    assert apps_mod.resolve_ansi_targets(["C:\\x\\a.lnk"], spawn_fn=lambda p: (_ for _ in ()).throw(OSError())) == {}


def test_resolver_stdin_uses_base64_utf8(monkeypatch):
    import subprocess as subprocess_mod

    captured: dict = {}

    class Proc:
        stdout = ""

    def fake_run(cmd, **kwargs):
        captured.update(kwargs)
        assert "powershell.exe" in cmd[0]
        return Proc()

    monkeypatch.setattr(subprocess_mod, "run", fake_run)
    apps_mod.resolve_ansi_targets(["C:\\한글\\卓\\a.lnk"])
    assert captured.get("encoding") == "utf-8"
    line = captured["input"].split("\n")[0]
    assert base64.b64decode(line).decode("utf-8") == "C:\\한글\\卓\\a.lnk"
    assert "FromBase64String" in apps_mod._RESOLVER_PS


def test_stable_id_case_insensitive():
    assert stable_id("C:\\X\\A.lnk") == stable_id("c:\\x\\a.lnk")
    assert len(stable_id("C:\\X\\A.lnk")) == 12


def test_discover_lists_unicode_and_marks_unresolvable(tmp_path):
    good = tmp_path / "GoodApp.lnk"
    good.write_bytes(_unicode_lnk("C:\\Windows\\notepad.exe"))
    bad = tmp_path / "BadApp.lnk"
    bad.write_bytes(_ansi_only_lnk())
    (tmp_path / "notes.txt").write_text("x")
    result = apps_mod.discover_catalog(dirs=[str(tmp_path)], resolve_ansi=lambda paths: {})
    names = {app["name"]: app for app in result["apps"]}
    assert "GoodApp" in names and "BadApp" in names
    assert names["BadApp"]["available"] is False and names["BadApp"]["unresolved"] is True
    ids_first = {app["id"] for app in result["apps"]}
    again = apps_mod.discover_catalog(dirs=[str(tmp_path)], resolve_ansi=lambda paths: {})
    assert {app["id"] for app in again["apps"]} == ids_first


def test_discover_empty_for_missing_dirs():
    assert apps_mod.discover_catalog(dirs=["C:\\nonexistent-dir-xyz"], resolve_ansi=lambda p: {}) == {"apps": [], "skipped": 0}


def test_search_and_choices_and_format():
    catalog = [
        {"id": "a1", "name": "Notepad", "folder": ".", "available": True},
        {"id": "b2", "name": "Notepad++", "folder": "Tools", "available": False},
    ]
    assert len(search_catalog(catalog, "note")) == 2
    assert search_catalog(catalog, "++")[0]["id"] == "b2"
    choices = to_autocomplete_choices(catalog)
    assert choices[0]["value"] == "a1"
    text = format_apps_list(catalog, 2)
    assert "[unavailable]" in text
    assert "[a1]" in text and "[b2]" in text
    assert format_apps_list([], 0).startswith("No applications")
    assert resolve_by_id(catalog, "a1")["name"] == "Notepad"
    assert resolve_by_id(catalog, "Notepad") is None


def test_launch_guards(tmp_path):
    with pytest.raises(ValueError):
        launch_app(None)
    with pytest.raises(ValueError):
        launch_app({"name": "x", "target": None, "unresolved": True})
    with pytest.raises(ValueError, match="unsafe"):
        launch_app({"name": "x", "target": "C:\\a\\b.bat", "unresolved": False})
    with pytest.raises(ValueError, match="unsafe"):
        launch_app({"name": "x", "target": "C:\\a\\..\\b.exe", "unresolved": False})
    with pytest.raises(ValueError, match="missing"):
        launch_app({"name": "x", "target": "C:\\nonexistent-xyz\\b.exe", "unresolved": False})
    exe = tmp_path / "tool.exe"
    exe.write_bytes(b"MZ")
    seen = {}

    class FakeChild:
        pid = 1234

    def fake_spawn(args, **kwargs):
        seen["args"] = args
        seen["kwargs"] = kwargs
        return FakeChild()

    assert launch_app({"name": "tool", "target": str(exe), "unresolved": False}, spawn_fn=fake_spawn) == "tool"
    assert seen["args"] == [str(exe)]
    assert seen["kwargs"].get("shell") is False
