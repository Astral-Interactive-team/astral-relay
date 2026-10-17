# Shared per-user path resolution for the Windows agent.
# Single source for the %LOCALAPPDATA%\AstralRelay directory so the error
# log and the installation identity/state file always resolve to the same
# location. Falls back to the temp directory when LocalAppData is absent.
# Contains no secret material and performs no I/O.

from __future__ import annotations

import os
from pathlib import Path


def state_dir(env=None) -> Path | None:
    """Resolve the per-user AstralRelay directory (LocalAppData, temp fallback)."""
    source = env if env is not None else os.environ
    base = source.get("LOCALAPPDATA") or source.get("TEMP") or source.get("TMP")
    return Path(base) / "AstralRelay" if base else None
