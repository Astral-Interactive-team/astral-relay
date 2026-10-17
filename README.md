# ASTRAL RELAY v0.1.0

<p align="center">
  <a href="https://github.com/Astral-Interactive-team/astral-relay/archive/refs/heads/main.zip">
    <img src="https://img.shields.io/badge/Download-Astral--Relay-8B5CF6?style=for-the-badge&logo=github&logoColor=white" alt="Download Astral Relay">
  </a>
  <a href="https://github.com/Astral-Interactive-team/astral-relay/stargazers">
    <img src="https://img.shields.io/github/stars/Astral-Interactive-team/astral-relay?color=8B5CF6&style=for-the-badge&label=%E2%98%85_Stars" alt="Star Astral Relay">
  </a>
  <a href="https://github.com/Astral-Interactive-team/astral-relay">
    <img src="https://img.shields.io/badge/Repo-astral--relay-181717?style=for-the-badge&logo=github&logoColor=white" alt="Official Repository">
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

The startup banner is stored in `astral_relay/cli/banner.txt`. The development CLI and production Agent use separate entry points.

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

### System Information Dashboard

Each managed computer publishes a full system report to its managed `#info` channel using Discord **Components V2**. The report is read-only and lists device identity, Windows/OS, CPU, memory, graphics, firmware, storage, network, power, security, installed software, processes, services, performance counters, environment availability, and Agent state.

There are no select menus, no pagination buttons, and no repeat commands. When the report does not fit in one message it continues in additional messages that are appended in order. Nothing is summarized or omitted, and facts the Agent cannot read are reported as `Unavailable` or `Not supported` instead of being guessed. See [System Report](#system-report) for what is and is not collected.

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
└── astral-relay.exe
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

### 2. Create a virtual environment (recommended)

```powershell
py -3.14 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

A virtual environment is recommended but not required.

### 3. Install dependencies

```powershell
python -m pip install -r requirements.txt
```

The `astral_relay` package lives at the repository root, so `python -m astral_relay` runs directly with any Python 3.14 interpreter that has these dependencies, without installing the package. To also run it from other directories, install it editable:

```powershell
python -m pip install --no-deps -e .
```

### 4. Launch Astral Relay

```powershell
python -m astral_relay
```

Run the command from the repository root. No package installation, global installation, or PATH modification is required.

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

Generating an Agent (option `01`, or `python scripts/build_exe.py`) prompts for:

| Prompt | Default | Effect |
|:--|:--|:--|
| Discord Bot Token | required | Embedded in the EXE as recoverable data. |
| Output EXE name | `astral-relay.exe` | Published under `dist/`. |
| Copy Agent into `%APPDATA%` | Yes | The EXE copies itself to `%APPDATA%\<name>\AstralRelay-Agent.exe` on launch so deleting the original keeps autostart working. |
| Register Windows autostart | Yes | The EXE registers `HKCU Run` and a logon task on launch. |

`<name>` is the output EXE name without its extension (for example `astral-relay`, or `MyAgent` for `MyAgent.exe`); the same name is used for the `%APPDATA%` folder, the `HKCU Run` value, and the logon task. Both install choices are embedded in the EXE at build time and are not asked on the target PC.

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
└── astral-relay.exe
```

The builder publishes the new executable only after verification succeeds and preserves the previous output when a build fails.

Each token-specific build currently requires a full PyInstaller rebuild, which can take several minutes.

## Discord Setup

The Python Agent uses **prefix commands**, not slash commands.

The bot requires the **Message Content Intent** to process messages beginning with `!pc`.

Enable the intent in both:

1. The Agent's Discord intent configuration.
2. Discord Developer Portal → Application → Bot → Privileged Gateway Intents.

The bot also needs **Manage Channels** to create the managed category and its `#info` channel, and **Manage Messages** to clear member messages posted in `#info`.

### Access Control

- Commands require a valid Discord guild context.
- The configured minimum management permission is required.
- Direct-message commands are rejected.
- Missing or invalid permission configuration fails closed.
- Authorization is checked before Windows operations.

Previously registered `/pc` slash commands may remain visible in Discord until removed.

The Agent no longer ships a removal script. Remove old registrations manually from the **Discord Developer Portal** (Application → Commands) if they still appear. This is an explicit operator action and never runs automatically during startup.

### Managed Categories

Each Agent installation manages exactly one category per guild.

- A random, non-secret **installation ID** is generated once and stored at `%LOCALAPPDATA%\AstralRelay\identity.json`, beside the sanitized error log.
- The category is named `<hostname> [<installation-id>]` and matched by that installation ID, so restarts, reconnects, and repeated `on_ready` events reuse the same category instead of creating more. The created category ID is remembered in the same file.
- Missing `Manage Channels` permission or Discord API failures warn once and are not retried in a loop.
- Categories left by older builds (`pc <hostname> (<host-id>)`) are adopted when unambiguous. Ambiguous or duplicate categories are reported to the file log and never deleted automatically.

Channels are added to the managed category one at a time, starting with `#info`:

- The bot creates a single `#info` text channel inside the category and publishes this computer's full system report there using Discord **Components V2** (no embeds, no select menus, no pagination). The channel ID and the ordered report message IDs are remembered in `identity.json`, so later starts refresh the same messages instead of posting duplicates.
- The report lists every collected fact from top to bottom. When it does not fit in one message, it continues in additional messages that are appended in order; sections that span a message boundary repeat their heading with `(continued)`.
- Long lists are never summarized or truncated: every installed application, every running process, and every service is listed.
- Values the Agent genuinely cannot read are shown as `Unavailable`, and features the platform does not expose are shown as `Not supported`. No placeholder numbers are invented.
- Member messages posted in `#info` are deleted immediately, and are never treated as commands. Bots and members can keep using `!pc ...` in the category's other channels.

### System Report

The report is produced by two modules:

- `astral_relay/agent/windows/inventory.py` collects the facts with read-only registry reads, ctypes calls, the existing Start Menu catalog, and a single base64-encoded PowerShell CIM pass. Each probe is guarded, so a partial failure only marks its own fields `Unavailable`.
- `astral_relay/agent/info_report.py` renders, splits, and publishes the Components V2 messages.

Collected sections: device identity, Windows/OS, CPU, memory (with modules and page file), graphics and displays, motherboard/BIOS/TPM/Secure Boot, storage (logical volumes, physical disks, health, BitLocker), network (per adapter), power and battery, Windows security and updates, installed software, processes and services, live performance counters, system directories and environment availability, and Agent state.

What the collector deliberately does not read or send:

- No tokens, passwords, product keys, cookies, credentials, clipboard contents, keystrokes, audio, camera, screen captures, file contents, or process memory.
- Only the Windows **Product ID** is read; the product key is never touched.
- Disk, service, BitLocker, TPM, and Defender probes are read-only.
- Process command lines and environment-variable values are never read; the environment section reports only which directories exist.

The only outbound request is one short-timeout HTTPS lookup of the public IPv4 address (`api.ipify.org`, falling back to `icanhazip.com`). It sends no credentials and no identifiers beyond the HTTP request itself. If it fails, the field shows `Unavailable`.

Two fields are inferred rather than reported by Windows directly, and are documented here so they are not mistaken for first-hand facts:

- **BIOS mode** is inferred from the presence of the Secure Boot state registry key (`HKLM\SYSTEM\CurrentControlSet\Control\SecureBoot\State`): present means `UEFI`, otherwise `Legacy BIOS`.
- **Internet connectivity** comes from whether the public-IPv4 lookup succeeded; when the lookup fails but the endpoint is still reachable, the field says so explicitly instead of claiming full connectivity.


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

Windows persistence is chosen at build time. When enabled, the EXE copies itself into `%APPDATA%\<name>` (named after the output EXE without its extension) and registers automatic start through `HKCU Run` plus a logon task using the same name. Disable either the `%APPDATA%` copy or autostart while building if that behavior is not wanted.

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

The automated tests cover configuration validation, authorization, application discovery, process-launch restrictions, payload handling, per-installation category management, output redaction, and packaging behavior.

Tests using mocks or test credentials do not prove that live Discord authentication, all Windows operations, or every startup behavior works correctly.

## Known Limitations

- Live Discord login and command execution require integration testing.
- Application discovery relies on supported Windows shortcuts.
- Some Windows Store and UWP applications are not discoverable.
- Some shortcut targets require the Windows-native resolver.
- Each token-specific build currently requires a full PyInstaller rebuild.
- The embedded bot token can be extracted from the executable.
- Automatic-start behavior should be reviewed before wider deployment.
- The system report is published only to managed `#info` channels and is not exposed as a prefix command.
- Report updates happen when the Agent starts; deleting a report message makes the Agent repost it on the next start.

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
├── astral_relay/
│   ├── cli/
│   │   └── banner.txt
│   ├── shared/
│   ├── agent/
│   └── builder/
├── tests/
│   └── python/
│       ├── unit/
│       ├── integration/
│       └── packaging/
├── scripts/
│   └── build_exe.py
├── pyproject.toml
├── requirements.txt
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