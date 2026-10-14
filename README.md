# Astral Relay

![Python](https://img.shields.io/badge/python-3.14-blue?logo=python&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6?logo=windows&logoColor=white)
![Rich](https://img.shields.io/badge/UI-rich%2015-purple)
![discord.py](https://img.shields.io/badge/discord.py-2.7.1-5865F2?logo=discord&logoColor=white)
![pytest](https://img.shields.io/badge/tests-139%20passed-green?logo=pytest&logoColor=white)
![PyInstaller](https://img.shields.io/badge/packaging-PyInstaller%20onefile-orange)

Discord-controlled Windows remote management agent. Python application with a Rich terminal UI. Three modes: development terminal, token-embedding build, silent production EXE.

## 1. Development: `python -m astral_relay`

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.lock
python -m astral_relay            # interactive CLI (HOME 1/2, RELAY 2/2)
python -m astral_relay --version
python -m astral_relay build      # non-interactive EXE build
```

Interactive full-screen console with banner, `01` Generate Agent EXE, `02` Start Agent (secure token prompt, memory-only), `Q` quit. UI code runs only through this entry point; imports never auto-display it. `q` or Ctrl+C during token entry cancels back to the menu.

## 2. Build: token prompt plus embedded payload

Build asks once for the Discord bot token (masked input):

```text
┌─[void@tool]──[~/home]
└── >> Discord Bot Token: ********
```

Empty or malformed tokens abort before packaging. The token plus default non-secret settings form a validated payload module bundled into an isolated staging copy, then packaged with PyInstaller `--onefile --noconsole`. Size, GUI subsystem, `--version` smoke, and `--self-test` are verified, and the result publishes atomically. Failures keep the previous valid EXE. A running Agent holding the output file is stopped once automatically before retrying. No `config.json` is created or required.

## 3. Production EXE: silent background start

Double-click `dist/AstralRelay-Agent.exe`: no window, no banner, no menu, no prompts. It reads the embedded token and settings, registers itself for Windows startup (`HKCU Run` + logon task, with a backup copy under `%APPDATA%\AstralRelay`), connects, ensures a per-computer category in each guild, and serves `!pc` prefix commands until stopped. Missing or corrupt payloads fail closed to a sanitized file log (`%LOCALAPPDATA%\AstralRelay\agent-error.log`), never to a console. Rejected tokens abort without retry.

## Guild operation

Prefix commands, no slash registration: `!pc status`, `!pc apps [query]`, `!pc open <id>`, `!pc lock` (case-insensitive). Every request needs guild context plus the configured management permission (default `ManageGuild`); ordinary members and DMs are rejected. Message Content Intent must be enabled in code and in the Discord Developer Portal. Previously registered `/pc` slash commands are removed once via `python scripts/clear_slash_commands.py` (explicit operator action).

## Token safety

Enter a **bot token** from the Discord developer portal, never a personal account token. The EXE contains the token as extractable plaintext: anyone holding the binary can recover it. Do not share the binary, use a dedicated revocable bot with minimum permissions, and rotate on exposure. The token never appears in command-line arguments, environment variables, logs, caches, fingerprints, filenames, or temporary files. No fake encryption is used.

## Tests and timings

```powershell
python -m pytest tests/python/unit tests/python/integration -q
ASTRAL_RUN_PACKAGING=1 python -m pytest tests/python/packaging -q
```

139 automated tests (unit + integration), no real Discord token needed (fakes injected). Each token-specific agent is a full PyInstaller rebuild (minutes). Packaging tests run in isolated directories and never overwrite `dist/AstralRelay-Agent.exe` unless explicitly requested.
