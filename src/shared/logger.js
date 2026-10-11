// Minimal console logger with secret redaction.
// Used by CLI and Agent. Every logged value passes through redact()
// so a bot token can never leak via terminal, logs, or audit records.

const TOKEN_KEY = /(token|secret|password|credential)/i;
const LONG_SECRET = /[A-Za-z0-9._\-]{30,}/g;
const TOKEN_SHAPE = /[\w-]{10,}\.[\w-]{4,}\.[\w-]{10,}/g;

// Replaces secret-looking values with [REDACTED]. Runs on strings,
// arrays, and plain objects. Token-shaped dotted values masked
// first so bot tokens never survive even beside ordinary text.
export function redact(value) {
  if (typeof value === 'string') {
    return value.replace(TOKEN_SHAPE, '[REDACTED]').replace(LONG_SECRET, '[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = TOKEN_KEY.test(key) ? '[REDACTED]' : redact(val);
    }
    return out;
  }
  return value;
}

function line(level, message, detail) {
  const stamp = new Date().toISOString();
  const safe = redact(detail === undefined ? '' : detail);
  const extra = detail === undefined ? '' : ' ' + JSON.stringify(safe);
  console.log(`[${stamp}] [${level}] ${redact(String(message))}${extra}`);
}

// Logs informational line. Detail object gets redacted first.
export function info(message, detail) {
  line('INFO', message, detail);
}

// Logs warning line. Detail object gets redacted first.
export function warn(message, detail) {
  line('WARN', message, detail);
}

// Logs error line. Detail object gets redacted first.
export function error(message, detail) {
  line('ERROR', message, detail);
}
