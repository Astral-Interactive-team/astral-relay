// AstralRelay production entry. Runs headless inside the GUI
// subsystem EXE: no banner, no menu, no prompts, no console output
// on ordinary launch. Token and settings come from the appended
// build-time payload only. Fatal startup problems go to the
// sanitized file log, never to a visible terminal. This module
// imports no development UI; dev menu lives under src/cli only.

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startClient } from './discord/client.js';
import { isFatalAuthError, loginWithBackoff } from './connection.js';
import { isPlausibleBotToken, readPayload } from './payload.js';
import { logFatal } from './error-log.js';
import { requireValidConfig } from '../shared/config.js';
import embeddedConfig from './embedded-config.json' with { type: 'json' };

// Mutes all console output for headless runs. Called before any
// agent code on ordinary launch; --version path prints first.
function silenceConsole() {
  for (const method of ['log', 'info', 'warn', 'debug', 'error']) {
    console[method] = () => {};
  }
}

// Loads production config plus token from appended payload. Fails
// closed with rebuild hints when missing, tokenless, or corrupt.
// Never throws the token itself.
export async function loadProductionConfig(execPath = process.execPath) {
  let found = null;
  try {
    found = await readPayload(execPath);
  } catch (err) {
    throw new Error(`Embedded payload unreadable: ${err.message}. Rebuild the EXE.`);
  }
  if (found === null) {
    throw new Error('No embedded payload. Rebuild the EXE with the current builder.');
  }
  if (!isPlausibleBotToken(found.token)) {
    throw new Error('Embedded payload holds no bot token. Rebuild the EXE with a fresh token.');
  }
  return { token: found.token, config: requireValidConfig(found.config) };
}

// Prints version without connecting. Builder runs EXE --version as
// startup smoke test proving the binary starts.
export function handleVersionFlag(argv, version = embeddedConfig.agentVersion) {
  if (argv.includes('--version') || argv.includes('-v')) {
    console.log(`AstralRelay-Agent v${version}`);
    return true;
  }
  return false;
}

// Runs agent with embedded token. Token never leaves this call
// frame except into discord.js login; never logged, stored, or
// passed to child processes. Invalid tokens abort without retry.
export async function runAgent({ token, config, login = loginWithBackoff, start = startClient } = {}) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('Empty token rejected.');
  }
  let client;
  try {
    client = await login(() => start(config, token.trim()));
  } catch (err) {
    if (isFatalAuthError(err)) {
      throw new Error('Discord rejected the embedded token. Rebuild the EXE with a fresh token.');
    }
    throw err;
  }
  const shutdown = async () => {
    try {
      await client.destroy();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return client;
}

// Silent entry: version flag prints, everything else runs headless.
export async function main(argv = process.argv.slice(2)) {
  if (handleVersionFlag(argv)) {
    return;
  }
  silenceConsole();
  try {
    const { token, config } = await loadProductionConfig();
    await runAgent({ token, config });
  } catch (err) {
    await logFatal(String((err && err.message) || err));
    process.exit(1);
  }
}

const isEntry =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main().catch(async (err) => {
    await logFatal(String((err && err.message) || err));
    process.exit(1);
  });
}
