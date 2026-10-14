# Packaging tests. Slow, isolated, never overwrite dist/AstralRelay-Agent.exe.
# Skipped unless ASTRAL_RUN_PACKAGING=1. Run explicitly after unit green.

import os

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("ASTRAL_RUN_PACKAGING") != "1",
    reason="packaging runs only with ASTRAL_RUN_PACKAGING=1",
)

from tests.python.unit.test_payload import TOKEN_A


def test_pyinstaller_onefile_smoke(tmp_path):
    import astral_relay.builder.build as build_mod

    monkeypatch_exe = tmp_path / "AstralRelay-Agent.exe"
    build_mod.DIST_DIR = tmp_path
    build_mod.OUTPUT_EXE = monkeypatch_exe
    build_mod.BUILD_TMP = tmp_path / "build-tmp"
    result = build_mod.build_agent(token=TOKEN_A)
    assert monkeypatch_exe.exists()
    assert "AstralRelay-Agent" in result["version_line"]
    from astral_relay.builder.subsystem import read_subsystem
    from astral_relay.builder.subsystem import IMAGE_SUBSYSTEM_WINDOWS_GUI

    assert read_subsystem(monkeypatch_exe.read_bytes()) == IMAGE_SUBSYSTEM_WINDOWS_GUI
