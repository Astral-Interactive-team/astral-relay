// Production payload for single-EXE distribution.
// Footer layout at end of file: [JSON bytes][length u32 LE][magic].
// Length covers JSON bytes only. Windows loader ignores overlay
// bytes, and the SEA runtime reads its own blob section, so plain
// appends do not touch executable code. Body holds {v, token,
// config}: bot token plus validated non-secret config. Anyone
// holding the EXE can extract the token, so treat the binary like
// a credential: do not share it, prefer revocable bot tokens, and
// never claim embedded plaintext is secure storage. No encryption
// theater: no key shipped beside its lock.

import { open } from 'node:fs/promises';
import { validateConfig } from '../shared/config.js';

export const PAYLOAD_MAGIC = 'ARCFG001';
export const PAYLOAD_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 65536;
const FOOTER_BYTES = 4 + 8;

// Offline bot-token shape check: three dot-separated base64url
// parts. Heuristic only, no network call. Rejects empty strings,
// user pastes without separators, and obvious garbage before any
// expensive packaging work starts.
export function isPlausibleBotToken(token) {
  if (typeof token !== 'string') {
    return false;
  }
  return /^[\w-]{10,}\.[\w-]{5,}\.[\w-]{10,}$/.test(token.trim());
}

// Builds footer buffer for token plus validated config. Throws on
// bad token shape, schema problems, or oversize, so bad data never
// reaches an EXE. Token stays in memory; never logged here.
export function buildProductionPayload(token, config) {
  if (!isPlausibleBotToken(token)) {
    throw new Error('Token rejected: expected bot token shape (three dot-separated parts).');
  }
  const problems = validateConfig(config);
  if (problems.length > 0) {
    throw new Error(`Payload config invalid: ${problems[0]}`);
  }
  const body = Buffer.from(JSON.stringify({ v: PAYLOAD_VERSION, token: token.trim(), config }), 'utf8');
  if (body.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${body.length} bytes.`);
  }
  const footer = Buffer.alloc(FOOTER_BYTES);
  footer.writeUInt32LE(body.length, 0);
  footer.write(PAYLOAD_MAGIC, 4, 'ascii');
  return Buffer.concat([body, footer]);
}

// Builds footer buffer for validated config object. Throws on
// schema problems or oversize, so bad data never reaches an EXE.
export function buildPayload(config) {
  const problems = validateConfig(config);
  if (problems.length > 0) {
    throw new Error(`Payload config invalid: ${problems[0]}`);
  }
  const body = Buffer.from(JSON.stringify({ v: PAYLOAD_VERSION, config }), 'utf8');
  if (body.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${body.length} bytes.`);
  }
  const footer = Buffer.alloc(FOOTER_BYTES);
  footer.writeUInt32LE(body.length, 0);
  footer.write(PAYLOAD_MAGIC, 4, 'ascii');
  return Buffer.concat([body, footer]);
}

// Appends production payload (token plus config) to exePath.
// Returns new file size.
export async function appendProductionPayload(exePath, token, config) {
  const payload = buildProductionPayload(token, config);
  const handle = await open(exePath, 'a');
  try {
    await handle.writeFile(payload);
    const meta = await handle.stat();
    return meta.size;
  } finally {
    await handle.close();
  }
}

// Appends payload footer to file at exePath. Returns new file size.
export async function appendPayload(exePath, config) {
  const payload = buildPayload(config);
  const handle = await open(exePath, 'a');
  try {
    await handle.writeFile(payload);
    const meta = await handle.stat();
    return meta.size;
  } finally {
    await handle.close();
  }
}

// Reads payload from executable. Returns {config, token, version}
// on success; token undefined for legacy token-free payloads.
// Null when no footer magic is present (plain template). Throws on
// truncated, corrupt, version-unknown, or schema-invalid payloads.
// Caller must fail closed on throw. Token value returned only to
// the production entry for immediate login use, never for logging.
export async function readPayload(exePath) {
  let handle;
  try {
    handle = await open(exePath, 'r');
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
  try {
    const meta = await handle.stat();
    if (meta.size < FOOTER_BYTES) {
      return null;
    }
    const footer = Buffer.alloc(FOOTER_BYTES);
    await handle.read(footer, 0, FOOTER_BYTES, meta.size - FOOTER_BYTES);
    if (footer.toString('ascii', 4, 12) !== PAYLOAD_MAGIC) {
      return null;
    }
    const length = footer.readUInt32LE(0);
    if (length === 0 || length > MAX_PAYLOAD_BYTES || length > meta.size - FOOTER_BYTES) {
      throw new Error('Payload footer corrupt: bad length.');
    }
    const body = Buffer.alloc(length);
    await handle.read(body, 0, length, meta.size - FOOTER_BYTES - length);
    let parsed;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('Payload footer corrupt: bad JSON.');
    }
    if (parsed === null || typeof parsed !== 'object' || parsed.v !== PAYLOAD_VERSION) {
      throw new Error('Payload version unsupported.');
    }
    const problems = validateConfig(parsed.config);
    if (problems.length > 0) {
      throw new Error(`Payload config invalid: ${problems[0]}`);
    }
    if (parsed.token !== undefined && !isPlausibleBotToken(parsed.token)) {
      throw new Error('Payload token malformed.');
    }
    return { config: parsed.config, token: parsed.token, version: parsed.v };
  } finally {
    await handle.close();
  }
}

// Strips payload footer when present, restoring plain template.
// Used only in tests and recovery; normal flow never mutates cache.
export async function stripPayload(exePath) {
  const handle = await open(exePath, 'r+');
  try {
    const meta = await handle.stat();
    if (meta.size < FOOTER_BYTES) {
      return false;
    }
    const footer = Buffer.alloc(FOOTER_BYTES);
    await handle.read(footer, 0, FOOTER_BYTES, meta.size - FOOTER_BYTES);
    if (footer.toString('ascii', 4, 12) !== PAYLOAD_MAGIC) {
      return false;
    }
    const length = footer.readUInt32LE(0);
    if (length === 0 || length > MAX_PAYLOAD_BYTES || length > meta.size - FOOTER_BYTES) {
      throw new Error('Payload footer corrupt: bad length.');
    }
    await handle.truncate(meta.size - FOOTER_BYTES - length);
    return true;
  } finally {
    await handle.close();
  }
}
