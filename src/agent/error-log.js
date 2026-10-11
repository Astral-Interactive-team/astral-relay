// Sanitized file diagnostics for silent production runs.
// The GUI-subsystem EXE shows no console, so fatal startup errors
// land here instead of a visible terminal. Only caller-supplied
// safe strings are written; values pass through the shared redactor
// (token shapes included), writes are best-effort and never throw.

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { redact } from '../shared/logger.js';

// Resolves log directory: LocalAppData on Windows, temp fallback.
function logDir(env = process.env) {
  const base = env.LOCALAPPDATA || env.TEMP || env.TMP;
  return base ? join(base, 'AstralRelay') : null;
}

// Appends one timestamped line. Never throws, never writes secrets.
export async function logFatal(message, env = process.env) {
  try {
    const dir = logDir(env);
    if (dir === null) {
      return;
    }
    await mkdir(dir, { recursive: true });
    const safe = JSON.stringify(redact(String(message)));
    await appendFile(join(dir, 'agent-error.log'), `[${new Date().toISOString()}] [FATAL] ${safe}\n`, 'utf8');
  } catch {
    // Diagnostics must not crash shutdown paths.
  }
}
