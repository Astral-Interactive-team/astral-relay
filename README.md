# Astral Relay

![Python](https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Windows](https://img.shields.io/badge/Windows-x64-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![Rich](https://img.shields.io/badge/Terminal_UI-Rich-8B5CF6?style=for-the-badge)
![discord.py](https://img.shields.io/badge/discord.py-2.7.1-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![PyInstaller](https://img.shields.io/badge/PyInstaller-One--File-FE7D37?style=for-the-badge&logo=python&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-139_Passed-2EA44F?style=for-the-badge&logo=pytest&logoColor=white)
![Status](https://img.shields.io/badge/Status-Experimental-orange?style=for-the-badge)

**A Discord-controlled Windows remote management agent.**

Astral Relay is a Python-based CLI application by **Astral Interactive** that builds a standalone Windows executable and connects it to Discord. It combines a terminal interface, Windows application discovery, permission-controlled commands, and single-file packaging.

> [!WARNING]
> Astral Relay is experimental. Live Discord integration and all target-PC operations have not yet been fully verified. The current build embeds the Discord bot token in the executable, where it can be extracted. Review the security considerations before running or distributing an Agent.

---

## Overview

Astral Relay consists of two main components:

| Component | Description |
|:--|:--|
| **Astral Relay CLI** | Interactive terminal interface for building and launching the Agent |
| **Astral Relay Agent** | Standalone Windows executable that connects to Discord and processes authorized commands |

The Agent communicates directly with Discord. No separate Astral Relay backend server is required.

### Features

- **CLI-first workflow** — terminal interface powered by Rich.
- **Standalone EXE** — package the Agent for Windows x64.
- **Discord integration** — control supported operations through prefix commands.
- **Application discovery** — search supported Windows Start Menu shortcuts.
- **Permission-based access control** — check guild context and member permissions.
- **Single-file packaging** — distribute the Agent as one executable.
- **Diagnostic logging** — write sanitized fatal errors to a local log file.

## Terminal Interface

Astral Relay uses a custom Kali-inspired terminal layout with Astral Interactive branding.

**HOME**
- GitHub
- Telegram
- Discord

**RELAY**
- Generate Agent EXE
- Start Agent

The startup banner is stored in `banner.txt`. The interactive development CLI and production Agent have separate entry points.

## Requirements

- Windows x64
- Python 3.14
- A Discord application and bot account
- A Discord server you own or are authorized to administer

## Quick Start

### 1. Open the repository

```powershell
cd C:\Users\User\Desktop\astral-relay
```

### 2. Create and activate a virtual environment

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```powershell
python -m pip install -r requirements.lock
python -m pip install --no-deps -e .
```

The editable installation makes the `src/astral_relay` package importable in the current environment.

### 4. Start Astral Relay

```powershell
python -m astral_relay
```

No global installation or PATH modification is required.

## CLI Commands

| Command | Description |
|:--|:--|
| `python -m astral_relay` | Open the interactive terminal menu |
| `python -m astral_relay --version` | Display the application version |
| `python -m astral_relay build` | Run the executable build workflow |
| `python scripts/build_exe.py` | Invoke the standalone packaging script |

The recommended development workflow is to launch the CLI and select **Generate Agent EXE** from the menu.

## Build Pipeline

Astral Relay uses PyInstaller to package the Python Agent.

The build process performs four stages:

1. **Validation** — validate the token and runtime configuration.
2. **Preparation** — create an isolated staging directory and prepare the embedded payload.
3. **Packaging** — generate a Windows x64 executable using PyInstaller.
4. **Verification** — validate the output, executable subsystem, version command, and self-test result before publication.

Output:

```text
dist/
└── AstralRelay-Agent.exe
```

The builder publishes the new executable only after verification succeeds and preserves the previous output when a build fails.

Each token-specific executable currently requires a full PyInstaller rebuild, which can take several minutes.

## Discord Commands

The Python Agent uses prefix commands rather than slash commands.

| Command | Description |
|:--|:--|
| `!pc status` | Display basic Agent and system status |
| `!pc apps` | List discovered applications |
| `!pc apps <query>` | Search the application catalog |
| `!pc open <id>` | Launch a discovered application by its identifier |
| `!pc lock` | Lock the current Windows session |

Commands are case-insensitive. For example, `!PC STATUS` and `!pc status` are equivalent.

The Agent requires guild context and the configured management permission. Direct messages are rejected, and members without sufficient permissions cannot execute Windows operations.

### Discord Setup

The bot requires the **Message Content Intent**.

Enable it in both:
- The Agent's intent configuration.
- Discord Developer Portal → Application → Bot → Privileged Gateway Intents.

Previously registered `/pc` slash commands may remain available until explicitly removed. To remove old registrations, review and run:

```powershell
python scripts/clear_slash_commands.py
```

This is an explicit operator action, not an automatic startup step.

## Production Agent

The production executable is built with PyInstaller `--onefile --noconsole`.

When launched, the Agent loads its embedded payload, initializes the Discord client, handles authorized commands, and writes sanitized fatal errors to:

```text
%LOCALAPPDATA%\AstralRelay\agent-error.log
```

The current implementation also registers Windows automatic-start mechanisms through `HKCU Run` and a logon task, with a backup copy under `%APPDATA%\AstralRelay`.

These behaviors must be understood before deployment. Run the Agent only on computers you own or are explicitly authorized to administer.

## Security Considerations

> [!CAUTION]
> **The Discord bot token is embedded in the generated EXE as recoverable data. Anyone who obtains the executable may be able to extract the token.**

Packaging does not encrypt the token. Obfuscation is not a substitute for protecting credentials.

Recommended precautions:

- Use a dedicated Discord bot with the minimum permissions required.
- Never use a personal Discord account token.
- Do not distribute an executable containing a token that should remain secret.
- Rotate the bot token immediately if exposure is suspected.
- Never commit credentials, local configuration, or sensitive logs to Git.
- Review the Agent's automatic-start behavior before deploying it.
- Use the Agent only on systems you own or are authorized to manage.

The current executable should be treated as an experimental, locally controlled build rather than a secure binary-distribution format.

## Testing

### Unit and integration tests

```powershell
python -m pytest tests/python/unit tests/python/integration -q
```

### Packaging tests

```powershell
$env:ASTRAL_RUN_PACKAGING = "1"
python -m pytest tests/python/packaging -q
```

The test suite covers configuration validation, authorization, application discovery, process-launch restrictions, redaction, payload handling, and packaging behavior.

Automated tests may use mocks and test credentials. Passing them does not prove that live Discord authentication, all Windows operations, or every startup behavior works correctly.

## Current Limitations

- Real Discord login, command execution, and permission enforcement require live integration testing.
- Application discovery is based on supported Windows shortcuts and does not cover every Windows or Store application.
- Non-ASCII shortcut targets may depend on the Windows-native resolver.
- Each token-specific build currently requires repackaging.
- The embedded bot token can be extracted from the executable.
- The Agent's automatic-start behavior should be reviewed before wider distribution.

## Project Structure

```text
astral-relay/
├── src/
│   └── astral_relay/
│       ├── cli/          # Interactive terminal interface
│       ├── shared/       # Configuration, errors, logging
│       ├── agent/        # Discord Agent and Windows operations
│       └── builder/      # Payload generation and EXE packaging
├── tests/
│   └── python/
│       ├── unit/
│       ├── integration/
│       └── packaging/
├── scripts/
│   ├── build_exe.py
│   └── clear_slash_commands.py
├── banner.txt
├── pyproject.toml
├── requirements.lock
└── README.md
```

## Astral Interactive

Part of the **Astral Interactive** software project collection.

[![GitHub](https://img.shields.io/badge/GitHub-Astral_Interactive-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Astral-Interactive-team)
[![Telegram](https://img.shields.io/badge/Telegram-astral__int-26A5E4?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/astral_int)
[![Discord](https://img.shields.io/badge/Discord-Join_Community-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.gg/bSvcQG8K4f)

---

<sub>Developed by Astral Interactive.</sub>