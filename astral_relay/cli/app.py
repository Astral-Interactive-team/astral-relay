# Development CLI application: `python -m astral_relay`.
# Opens the interactive menu by default; `build` regenerates the EXE
# non-interactively through the same pipeline as menu option 01.
# Ported from bin/astral-relay.js.

from __future__ import annotations

import argparse
import sys

from astral_relay import AGENT_VERSION


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(prog="astral-relay", description="Build and run AstralRelay Agent EXE.")
    parser.add_argument("--version", "-v", action="store_true", help="Print version and exit.")
    sub = parser.add_subparsers(dest="command")
    build_cmd = sub.add_parser("build", help="Generate dist/astral-relay.exe.")
    build_cmd.add_argument("--version", "-v", action="store_true", help="Print version and exit.")
    return parser


def main(argv=None) -> int:
    """Run the CLI. Returns a process exit code."""
    args = build_parser().parse_args(argv)
    if args.version:
        print(f"astral-relay {AGENT_VERSION}")
        return 0
    if getattr(args, "command", None) == "build":
        from rich.console import Console

        from astral_relay.cli.menu import run_generate
        from astral_relay.cli.theme import supports_color

        enabled = supports_color()
        console = Console(no_color=not enabled, highlight=False)
        return 0 if run_generate(console, enabled) else 1
    from astral_relay.cli.menu import run_menu

    try:
        return run_menu()
    except KeyboardInterrupt:
        return 0
    except Exception as exc:  # noqa: BLE001 - top-level guard, message is sanitized
        print(f"Menu failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
