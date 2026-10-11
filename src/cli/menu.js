// Interactive two-page terminal menu for `npm run dev`.
// Page 1 (HOME): social links — GitHub, Telegram, Discord.
// Page 2 (RELAY): agent operations — Generate EXE, Start Agent.
// Kali-styled box-drawing layout. Banner prints once per invocation;
// page navigation redraws only the current page menu. Handles
// Ctrl+C, EOF, and empty input cleanly, never throws on cancellation.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePageBlock, loadBannerText, relayPageBlock, renderBanner } from './banner.js';
import { cyan, darkPurple, purple, red, supportsColor, white, yellow } from './theme.js';
import { INTERRUPTED, promptForToken } from '../agent/secure-input.js';
import { defaultRuntimeConfig } from '../shared/config.js';
import { error } from '../shared/logger.js';
import { buildCommand } from './commands/build.js';
import { SOCIAL_LINKS } from './social-links.js';

// Opens a validated HTTPS URL in the system default browser.
// Restricted to the SOCIAL_LINKS allowlist — never opens arbitrary input.
// Returns true on successful spawn, false with a printed warning on failure.
export async function openUrl(url, enabled) {
  const allowed = Object.values(SOCIAL_LINKS);
  if (!allowed.includes(url)) {
    console.log(red(`Blocked: "${url}" is not an allowed URL.`, enabled));
    return false;
  }
  return new Promise((resolve) => {
    try {
      // Cross-platform: `start` on Windows, `xdg-open` on Linux, `open` on macOS.
      const cmd = process.platform === 'win32' ? 'cmd'
        : process.platform === 'darwin' ? 'open'
        : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', shell: false });
      child.on('error', (err) => {
        console.log(yellow(`Could not open browser: ${err.message}`, enabled));
        resolve(false);
      });
      child.unref();
      resolve(true);
    } catch (err) {
      console.log(yellow(`Could not open browser: ${err.message}`, enabled));
      resolve(false);
    }
  });
}

// Builds Kali-style two-line prompt strings. Line 1 is printed before
// awaiting input; line 2 is the rl.question string so the cursor sits
// immediately after >> with no extra text. Exported for tests.
// Special characters are styled in dark purple; non-special characters in purple.
export function kaliPromptLines(enabled) {
  const dp = (char) => darkPurple(char, enabled);
  const p = (text) => purple(text, enabled);

  // ┌─[astral@relay]──[~/Astral_int]
  const line1 =
    dp('┌─') +
    dp('[') +
    p('astral') +
    dp('@') +
    p('relay') +
    dp(']') +
    dp('──') +
    dp('[') +
    dp('~') +
    dp('/') +
    p('Astral_int') +
    dp(']');

  // └── >> 
  const line2 = dp('└── ') + dp('>>') + ' ';
  return { line1, line2 };
}

// Reads one menu line; rejects INTERRUPTED on Ctrl+C.
// Prints the Kali two-liner then awaits input on the second line.
function readChoice(rl, enabled) {
  const { line1, line2 } = kaliPromptLines(enabled);
  console.log(line1);
  let onSigint;
  const interrupted = new Promise((_, reject) => {
    onSigint = () => reject(new Error(INTERRUPTED));
    rl.on('SIGINT', onSigint);
  });
  return Promise.race([rl.question(line2), interrupted]).finally(() => {
    rl.removeListener('SIGINT', onSigint);
  });
}

// Parses HOME-page input. Returns action string or null for invalid.
export function parseHomeChoice(raw) {
  const c = String(raw ?? '').trim().toLowerCase();
  if (c === '1' || c === '01') return 'github';
  if (c === '2' || c === '02') return 'telegram';
  if (c === '3' || c === '03') return 'discord';
  if (c === 'n' || c === 'next') return 'next';
  if (c === 'q' || c === 'quit' || c === 'exit' || c === '') return 'exit';
  return null;
}

// Parses RELAY-page input. Returns action string or null for invalid.
export function parseRelayChoice(raw) {
  const c = String(raw ?? '').trim().toLowerCase();
  if (c === '1' || c === '01') return 'generate';
  if (c === '2' || c === '02') return 'start';
  if (c === 'b' || c === 'back') return 'back';
  if (c === 'q' || c === 'quit' || c === 'exit') return 'exit';
  return null;
}

// Legacy export — maps relay-page choices. Kept for test compatibility.
export function parseDevChoice(raw) {
  return parseRelayChoice(raw);
}

// Starts agent with freshly entered token. Token memory-only: never
// stored, logged, or passed to child processes. Failures print a
// token-free message and return to menu.
async function startFromMenu(enabled) {
  let token = '';
  try {
    token = await promptForToken({ input: stdin, output: stdout });
  } catch (err) {
    if (err !== null && err.message === INTERRUPTED) {
      console.log(cyan('\nBye.', enabled));
      process.exit(0);
    }
    console.log(yellow(String((err && err.message) || err), enabled));
    return;
  }
  try {
    // Agent entry statically imports its embedded fallback, which
    // exists only during builds. Stage placeholder defaults for the
    // import when missing; builder staging is never overwritten.
    // Temporary file removed afterwards; gitignored regardless.
    const here = dirname(fileURLToPath(import.meta.url));
    const staged = join(here, '..', 'agent', 'embedded-config.json');
    let created = false;
    try {
      await writeFile(staged, JSON.stringify(defaultRuntimeConfig(), null, 2), { flag: 'wx' });
      created = true;
    } catch {
      // Staging already present; reuse as-is.
    }
    try {
      const { runAgent } = await import('../agent/index.js');
      await runAgent({ token, config: defaultRuntimeConfig() });
    } finally {
      if (created) {
        await rm(staged, { force: true });
      }
    }
  } catch (err) {
    error('Agent failed to start.', { message: String((err && err.message) || err) });
  }
}

// Runs two-page menu loop until user quits or cancels.
// Banner prints once; navigation only redraws the current page block.
export async function runMenu() {
  const enabled = supportsColor();
  const width = stdout.isTTY === true && typeof stdout.columns === 'number' ? stdout.columns : null;

  // Banner once.
  const art = renderBanner(await loadBannerText(), enabled, width);
  if (art !== '') {
    console.log(art);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let page = 'home'; // 'home' | 'relay'

  try {
    let firstDraw = true;
    for (;;) {
      // Always redraw current page (first draw included).
      if (page === 'home') {
        console.log(homePageBlock(enabled));
      } else {
        console.log(relayPageBlock(enabled));
      }
      firstDraw = false;

      let raw = '';
      try {
        raw = await readChoice(rl, enabled);
      } catch (err) {
        if (err !== null && err.message === INTERRUPTED) {
          console.log(cyan('\nBye.', enabled));
          return;
        }
        console.log(cyan('Cancelled. Bye.', enabled));
        return;
      }

      if (page === 'home') {
        const choice = parseHomeChoice(raw);
        if (choice === 'github') {
          await openUrl(SOCIAL_LINKS.github, enabled);
        } else if (choice === 'telegram') {
          await openUrl(SOCIAL_LINKS.telegram, enabled);
        } else if (choice === 'discord') {
          await openUrl(SOCIAL_LINKS.discord, enabled);
        } else if (choice === 'next') {
          page = 'relay';
        } else if (choice === 'exit') {
          console.log(cyan('Bye.', enabled));
          return;
        } else {
          console.log(yellow('Unknown option. Enter 01, 02, 03, N, or Q.', enabled));
        }
      } else {
        const choice = parseRelayChoice(raw);
        if (choice === 'generate') {
          await buildCommand();
        } else if (choice === 'start') {
          await startFromMenu(enabled);
        } else if (choice === 'back') {
          page = 'home';
        } else if (choice === 'exit') {
          console.log(cyan('Bye.', enabled));
          return;
        } else {
          console.log(yellow('Unknown option. Enter 01, 02, B, or Q.', enabled));
        }
      }
    }
  } finally {
    rl.close();
  }
}
