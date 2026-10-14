# Sanitized file diagnostics for silent production runs.
# The windowed EXE shows no console, so fatal startup errors land here
# instead of a visible terminal. Only caller-supplied safe strings are
# written; values pass through the shared redactor. Writes are
# best-effort and never throw. Ported from src/agent/error-log.js.

from __future__ import annotations

import datetime
import os
from pathlib import Path

from astral_relay.shared.logging_utils import redact


def log_dir(env=None) -> Path | None:
    """Resolve the log directory: LocalAppData on Windows, temp fallback."""
    source = env if env is not None else os.environ
    base = source.get("LOCALAPPDATA") or source.get("TEMP") or source.get("TMP")
    return Path(base) / "AstralRelay" if base else None


def log_fatal(message: str, env=None) -> None:
    """Append one timestamped line. Never throws, never writes secrets."""
    try:
        directory = log_dir(env)
        if directory is None:
            return
        directory.mkdir(parents=True, exist_ok=True)
        safe = str(redact(str(message))).replace("\n", " ")
        stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
        with open(directory / "agent-error.log", "a", encoding="utf-8") as handle:
            handle.write(f"[{stamp}] [FATAL] {safe}\n")
    except OSError:
        pass
