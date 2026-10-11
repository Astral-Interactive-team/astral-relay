# Astral Relay

Discord-controlled Windows remote management agent. Requires Node.js 24 or newer for development and builds. Three modes: development terminal, token-embedding build, silent production EXE.

## 1. Development: `npm run dev`

Interactive void-styled console with banner, `01` Generate Agent EXE, `02` Start Agent (secure token prompt, memory-only), `00` Exit (`Q` works too). UI code runs only through this entry point; imports never auto-display it.

## 2. Build: token prompt plus embedded payload

```powershell
npm run dev
# pick 01, or: astral-relay build
```

Build asks once for the Discord bot token (masked input):

```text
┌─[void@tool]──[~/home]
└── >> Discord Bot Token: ********
```

Empty or malformed tokens abort before packaging. The token plus default non-secret settings form a validated production payload appended to a cached token-free template (`build-cache/`, git-ignored). Payload roundtrip is verified, the EXE is flipped to the GUI subsystem, `--version` smoke runs, and the result publishes atomically. Failures keep the previous valid EXE. If the previous EXE is locked, stop the running Agent first: a running EXE locks its own file. Token changes reuse the template (seconds); source or dependency changes repackage it. No `config.json` is created or required.

## 3. Production EXE: silent background start

Double-click `dist/AstralRelay-Agent.exe`: no window, no banner, no menu, no prompts. It reads the embedded token and settings, connects, and serves `/pc` in every installed guild until stopped. On startup it also clears stale guild-scoped command copies left by older builds, so each command appears once. Missing or corrupt payloads fail closed to a sanitized file log (`%LOCALAPPDATA%\AstralRelay\agent-error.log`), never to a console. Rejected tokens abort without retry.

## Guild operation

Commands register globally after login (up to an hour to appear everywhere). Every request needs guild context plus the configured management permission (default `ManageGuild`); ordinary members and DMs are rejected. Install the bot with the `applications.commands` scope in each guild.

## Token safety

Enter a **bot token** from the Discord developer portal, never a personal account token. The EXE contains the token as extractable plaintext: anyone holding the binary can recover it. Do not share the binary, use a dedicated revocable bot with minimum permissions, and rotate on exposure. The token never appears in logs, caches, fingerprints, filenames, or temporary files. No fake encryption is used.

## Tests and timings

```powershell
npm test
```

147 automated tests, no real Discord token needed (fakes injected). Cold template packaging ~80-135 s, warm injection ~4-30 s (security software scanning varies file-operation time).
