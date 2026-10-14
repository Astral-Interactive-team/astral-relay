# ASTRAL RELAY v0.1.0

<p align="center">
  <a href="https://github.com/Astral-Interactive-team/astral-relay/archive/refs/heads/main.zip">
    <img src="https://img.shields.io/badge/⬇_Download-Astral--Relay-8B5CF6?style=for-the-badge&logo=github&logoColor=white" alt="Download Astral Relay">
  </a>
  <a href="https://github.com/Astral-Interactive-team/astral-relay/stargazers">
    <img src="https://img.shields.io/github/stars/Astral-Interactive-team/astral-relay?color=8B5CF6&style=for-the-badge&label=⭐_Star_Astral_Relay" alt="Star Astral Relay">
  </a>
  <a href="https://github.com/Astral-Interactive-team/astral-relay">
    <img src="https://img.shields.io/badge/Official-Astral--Interactive%2Fastral--relay-181717?style=for-the-badge&logo=github&logoColor=white" alt="Official Repository">
  </a>
</p>

<p align="center">
  <b>A Discord-controlled Windows remote management agent.</b>
  <br>
  Developed by <b>Astral Interactive</b>.
</p>

---

> [!CAUTION]
> **Experimental software.** Use only on computers you own or are explicitly authorized to administer.
>
> The current production build embeds the Discord bot token in the executable as recoverable data. Anyone who obtains the EXE may be able to extract the token. Do not distribute a token-bearing executable to untrusted recipients.

## Overview

**Astral Relay** is a Python-based CLI application that builds a standalone Windows executable and connects it directly to Discord.

It combines a custom Rich terminal interface, Windows application discovery, permission-controlled commands, and single-file executable packaging.

No separate Astral Relay backend server is required.

## Features

### Terminal Interface

Astral Relay provides a custom terminal interface with Astral Interactive branding.

| Page | Features |
|:--|:--|
| HOME | GitHub, Telegram, Discord |
| RELAY | Generate Agent EXE, Start Agent |

The startup banner is stored in `banner.txt`. The development CLI and production Agent use separate entry points.

### Discord Agent

The Agent connects to Discord and processes supported prefix commands.

| Command | Description |
|:--|:--|
| `!pc status` | Display basic Agent and system status |
| `!pc apps` | List discovered applications |
| `!pc apps <query>` | Search the application catalog |
| `!pc open <id>` | Launch a discovered application |
| `!pc lock` | Lock the current Windows session |

Commands are case-insensitive. For example, `!PC STATUS` is equivalent to `!pc status`.

### Windows Application Discovery

Astral Relay discovers supported applications through Windows Start Menu shortcuts.

The application catalog is generated locally. `/pc open` is not used; the Python Agent uses the `!pc open <id>` prefix command and validates the selected application before launching it.

Unsupported shortcut types and unresolved executable targets are handled conservatively.

### Executable Builder

Astral Relay packages its Agent using PyInstaller.

The build pipeline validates the configuration, prepares an isolated staging directory, packages the application, verifies the executable, and publishes the result only after validation succeeds.

Generated executable:

```text
dist/
└── AstralRelay-Agent.exe
```

If the build fails verification, the previous executable is preserved.

## Requirements

| Dependency | Version |
|:--|:--|
| Python | 3.14 |
| Rich | 15.0.0 |
| discord.py | 2.7.1 |
| PyInstaller | 6.15.0 |
| pytest | 8.3.4 |

A Discord application and bot account are required for live Discord testing.

## Installation

### 1. Clone the repository

```powershell
git clone https://github.com/Astral-Interactive-team/astral-relay.git
cd astral-relay
```

Alternatively, download and extract the source ZIP from the download link above.

### 2. Create a virtual environment

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```powershell
python -m pip install -r requirements.lock
python -m pip install --no-deps -e .
```

The editable installation makes the `src/astral_relay` package importable from the active environment.

### 4. Launch Astral Relay

```powershell
python -m astral_relay
```

No global installation or PATH modification is required.

## Usage

Launch the interactive CLI:

```powershell
python -m astral_relay
```

Available menu actions:

| Option | Action |
|:--|:--|
| `01` | Generate Agent EXE |
| `02` | Start Agent |
| `N` | Open the RELAY page |
| `B` | Return to HOME |
| `Q` | Exit |

Display the version:

```powershell
python -m astral_relay --version
```

To invoke the standalone build script directly:

```powershell
python scripts/build_exe.py
```

The recommended workflow is to generate the Agent through the interactive menu.

## Build Pipeline

The build process performs four stages:

1. **Validation** — validate the token and runtime configuration.
2. **Preparation** — create an isolated staging directory and prepare the embedded payload.
3. **Packaging** — generate a Windows x64 executable using PyInstaller.
4. **Verification** — validate the output, executable subsystem, version command, and self-test result before publication.

The final output is:

```text
dist/
└── AstralRelay-Agent.exe
```

The builder publishes the new executable only after verification succeeds and preserves the previous output when a build fails.

Each token-specific build currently requires a full PyInstaller rebuild, which can take several minutes.

## Discord Setup

The Python Agent uses **prefix commands**, not slash commands.

The bot requires the **Message Content Intent** to process messages beginning with `!pc`.

Enable the intent in both:

1. The Agent's Discord intent configuration.
2. Discord Developer Portal → Application → Bot → Privileged Gateway Intents.

### Access Control

- Commands require a valid Discord guild context.
- The configured minimum management permission is required.
- Direct-message commands are rejected.
- Missing or invalid permission configuration fails closed.
- Authorization is checked before Windows operations.

Previously registered `/pc` slash commands may remain available until explicitly removed.

To remove old slash-command registrations, review and run:

```powershell
python scripts/clear_slash_commands.py
```

This is an explicit operator action and should not run automatically during startup.

## Security

> [!WARNING]
> **The current executable contains a recoverable Discord bot token. Packaging is not encryption.**

The token is embedded in the production payload. Anyone with access to the generated executable may be able to extract it.

Recommended precautions:

- Use a dedicated Discord bot with the minimum required permissions.
- Never use a personal Discord account token.
- Avoid distributing an executable containing a sensitive bot token.
- Rotate the bot token if exposure is suspected.
- Never commit credentials or sensitive local configuration to Git.
- Review the Agent's automatic-start behavior before deployment.
- Run the Agent only on systems you own or are authorized to administer.

The current production implementation registers Windows automatic-start mechanisms through `HKCU Run` and a logon task, with a backup copy under `%APPDATA%\AstralRelay`.

The Agent runs without a visible console window. Understand these behaviors before launching it or distributing the executable.

**The current build should be treated as an experimental, locally controlled application rather than a secure binary-distribution format.**

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

The automated tests cover configuration validation, authorization, application discovery, process-launch restrictions, payload handling, output redaction, and packaging behavior.

Tests using mocks or test credentials do not prove that live Discord authentication, all Windows operations, or every startup behavior works correctly.

## Known Limitations

- Live Discord login and command execution require integration testing.
- Application discovery relies on supported Windows shortcuts.
- Some Windows Store and UWP applications are not discoverable.
- Some shortcut targets require the Windows-native resolver.
- Each token-specific build currently requires a full PyInstaller rebuild.
- The embedded bot token can be extracted from the executable.
- Automatic-start behavior should be reviewed before wider deployment.

## Project Status

| Area | Status |
|:--|:--|
| Python CLI | Implemented |
| Terminal interface | Implemented |
| EXE packaging | Packaging tests passed |
| Authorization | Automated tests available |
| Live Discord integration | Pending verification |
| Target-PC operations | Pending verification |

Astral Relay remains experimental until live Discord integration and target-Windows operations have been verified.

## Project Structure

```text
astral-relay/
├── src/
│   └── astral_relay/
│       ├── cli/
│       ├── shared/
│       ├── agent/
│       └── builder/
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

---

## Community

<p align="center">
  <a href="https://t.me/astral_int">
    <img src="https://img.shields.io/badge/Telegram-astral__int-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Astral Interactive on Telegram">
  </a>
  <a href="https://discord.gg/bSvcQG8K4f">
    <img src="https://img.shields.io/badge/Discord-Join_Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Astral Interactive Discord">
  </a>
</p>

<p align="center">
  <sub>Developed by Astral Interactive.</sub>
</p>