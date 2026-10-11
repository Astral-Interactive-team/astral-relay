// Windows PE subsystem switch for silent production EXE.
// The packager offers no console/GUI option, so the builder flips
// the subsystem field after packaging: CUI (console window on
// launch) becomes GUI (no window on double-click). Only two header
// bytes change; code, SEA blob, and appended payload overlay stay
// untouched. Piped stdio still works, so --version smoke tests
// keep passing. Note: flipping this field invalidates Authenticode
// signatures; unsigned builds are unaffected.

import { readFile, writeFile } from 'node:fs/promises';

export const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
export const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;
const PE32PLUS_MAGIC = 0x20b;
const SUBSYSTEM_OFFSET_FROM_OPTIONAL = 68;

// Locates the subsystem field in a PE image. Returns byte offset
// or -1 when headers are missing or malformed. Never throws.
export function subsystemOffset(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) {
    return -1;
  }
  if (buffer.readUInt16LE(0) !== 0x5a4d) {
    return -1;
  }
  const peStart = buffer.readUInt32LE(0x3c);
  if (peStart + 6 > buffer.length) {
    return -1;
  }
  if (buffer.toString('ascii', peStart, peStart + 4) !== 'PE\0\0') {
    return -1;
  }
  const optionalStart = peStart + 4 + 20;
  if (optionalStart + 2 > buffer.length) {
    return -1;
  }
  if (buffer.readUInt16LE(optionalStart) !== PE32PLUS_MAGIC) {
    return -1;
  }
  const field = optionalStart + SUBSYSTEM_OFFSET_FROM_OPTIONAL;
  if (field + 2 > buffer.length) {
    return -1;
  }
  return field;
}

// Returns copy of buffer with GUI subsystem set. Throws on
// non-PE input so bad binaries never ship silently.
export function withGuiSubsystem(buffer) {
  const at = subsystemOffset(buffer);
  if (at < 0) {
    throw new Error('Not a 64-bit Windows executable.');
  }
  const out = Buffer.from(buffer);
  out.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, at);
  return out;
}

// Reads current subsystem value, or null when not a PE image.
export function readSubsystem(buffer) {
  const at = subsystemOffset(buffer);
  if (at < 0) {
    return null;
  }
  return buffer.readUInt16LE(at);
}

// Patches file at exePath to GUI subsystem. Returns previous value.
// Throws on malformed input.
export async function setGuiSubsystem(exePath) {
  const data = await readFile(exePath);
  const previous = readSubsystem(data);
  if (previous === null) {
    throw new Error('Not a 64-bit Windows executable.');
  }
  if (previous === IMAGE_SUBSYSTEM_WINDOWS_GUI) {
    return previous;
  }
  await writeFile(exePath, withGuiSubsystem(data));
  return previous;
}
