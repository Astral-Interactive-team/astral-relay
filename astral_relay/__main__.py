# Package entry point for `python -m astral_relay`.
# Delegates to the development CLI application. Importing this module
# has no side effects; execution starts in main() only.

from astral_relay.cli.app import main

if __name__ == "__main__":
    raise SystemExit(main())
