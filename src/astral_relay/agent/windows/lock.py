# Windows session lock for !pc lock.
# Uses LockWorkStation via ctypes, the supported mechanism. Fixed call,
# no shell, fails safe with a clear message.
# Ported from src/agent/windows/lock.js.

from __future__ import annotations

from typing import Callable


def lock_session(run: Callable[[], int] | None = None) -> None:
    """Lock the current session. Throws a readable error when it cannot run."""
    if run is not None:
        result = run()
        if isinstance(result, Exception):
            raise RuntimeError(f"Lock failed: {result}")
        if isinstance(result, int) and result != 0:
            raise RuntimeError(f"Lock failed with exit code {result}.")
        return
    try:
        import ctypes

        locked = ctypes.windll.user32.LockWorkStation()
    except (AttributeError, OSError) as exc:
        raise RuntimeError(f"Lock failed: {exc}") from exc
    if not locked:
        raise RuntimeError("Lock failed with exit code 1.")
