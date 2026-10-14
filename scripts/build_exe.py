# Production EXE build script: python scripts/build_exe.py
# Prompts for the token with masked input, then runs the isolated
# staging PyInstaller onefile build. Run from the repository root.

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from astral_relay.builder.build import build_agent, prompt_exe_name  # noqa: E402


def main() -> int:
    try:
        result = build_agent(output_name=prompt_exe_name())
    except KeyboardInterrupt:
        return 0
    except Exception as exc:  # noqa: BLE001 - build errors are user-safe by construction
        from astral_relay.agent.secure_input import InterruptedError as TokenCancelled

        if isinstance(exc, TokenCancelled):
            print("Cancelled.")
            return 1
        print(f"Build failed: {exc}")
        return 1
    print(f"Build passed: {result['exe_path']}")
    print(f"Smoke test: {result['version_line']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
