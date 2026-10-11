// Secure terminal input for bot token entry.
// Masks typing with * when raw mode exists, else falls back to
// plain readline. After entry, the input line is always rewritten
// with stars only, so terminal-echoed plaintext never stays on
// screen. Token value never printed. Ctrl+C aborts cleanly with
// a typed interrupt callers translate to graceful shutdown.

import { createInterface } from 'node:readline/promises';

export const INTERRUPTED = 'INTERRUPTED';

// Void-style prompt header. Shared by dev CLI menu and build
// prompt so both surfaces look identical.
export function voidHeader() {
  return '┌─[void@tool]──[~/home]';
}

// Void-style prompt prefix for input lines.
export function voidPrompt(label) {
  return `└── >> ${label}: `;
}

// Rewrites the current input line as prefix plus stars, erasing
// anything the terminal echoed. TTY only; pipes keep raw text.
function concealLine(output, prefix, count) {
  if (output.isTTY !== true) {
    return;
  }
  output.write(`\r\x1b[2K${prefix}${'*'.repeat(count)}`);
}

// Reads one line with per-character masking. Resolves token text
// (untrimmed). Rejects with Error(INTERRUPTED) on Ctrl+C. Streams
// and prompt prefix injectable for tests.
export function readSecureLine({ input = process.stdin, output = process.stdout, prefix = '' } = {}) {
  const canMask = input.isTTY === true && typeof input.setRawMode === 'function';
  if (!canMask) {
    return readFallbackLine({ input, output, prefix });
  }
  return new Promise((resolve, reject) => {
    let buffer = '';
    const cleanup = () => {
      try {
        input.setRawMode(false);
      } catch {
        // TTY already gone; resolve path stands.
      }
      input.pause();
      input.removeListener('data', onData);
    };
    const onData = (chunk) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === '\r' || char === '\n') {
          cleanup();
          concealLine(output, prefix, buffer.length);
          output.write('\n');
          resolve(buffer);
          return;
        }
        if (char === '\x03') {
          cleanup();
          output.write('\n');
          reject(new Error(INTERRUPTED));
          return;
        }
        if (char === '\x7f' || char === '\b') {
          if (buffer.length > 0) {
            buffer = buffer.slice(0, -1);
            output.write('\b \b');
          }
          continue;
        }
        if (char >= ' ' && char !== '\x7f') {
          buffer += char;
          output.write('*');
        }
      }
    };
    try {
      input.setRawMode(true);
    } catch {
      cleanup();
      readFallbackLine({ input, output, prefix }).then(resolve, reject);
      return;
    }
    input.resume();
    input.on('data', onData);
  });
}

// Plain readline fallback when raw mode missing. Warns that echo
// stays on, then rewrites the echoed line with stars on TTY.
function readFallbackLine({ input, output, prefix }) {
  output.write('(terminal masking unavailable; input will echo)\n');
  const rl = createInterface({ input, output });
  return rl.question('').then((line) => {
    try {
      rl.close();
    } catch {
      // Interface already closed; value stands.
    }
    if (output.isTTY === true) {
      output.write(`\x1b[1A\x1b[2K\r${prefix}${'*'.repeat(line.length)}\n`);
    }
    return line;
  });
}

// Prompts for bot token with void header. Trims and validates
// non-empty; returns token or throws on empty/interrupt. Never
// prints or logs the value.
export async function promptForToken(streams = {}, context = '[~]') {
  const output = streams.output || process.stdout;
  const header = context === '[~]' ? voidHeader() : `┌──(Astral㉿Agent)-${context}`;
  const prefix = voidPrompt('Discord Bot Token');
  output.write(header + '\n');
  output.write(prefix);
  const token = (await readSecureLine({ ...streams, prefix })).trim();
  if (token === '') {
    throw new Error('Empty token rejected. Paste a bot token from the Discord developer portal.');
  }
  return token;
}
