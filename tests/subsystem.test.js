// PE subsystem switch tests. Crafted headers stand in for real
// binaries; layout math identical. Covers offset discovery,
// GUI flip, input validation, idempotence, and file roundtrip.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IMAGE_SUBSYSTEM_WINDOWS_CUI,
  IMAGE_SUBSYSTEM_WINDOWS_GUI,
  readSubsystem,
  setGuiSubsystem,
  subsystemOffset,
  withGuiSubsystem,
} from '../src/builder/subsystem.js';

const PE_START = 0x40;
const FIELD = PE_START + 4 + 20 + 68;

// Builds minimal PE32+ image with chosen subsystem value.
function fakePE(subsystem = IMAGE_SUBSYSTEM_WINDOWS_CUI) {
  const buffer = Buffer.alloc(FIELD + 2, 0);
  buffer.writeUInt16LE(0x5a4d, 0);
  buffer.writeUInt32LE(PE_START, 0x3c);
  buffer.write('PE\0\0', PE_START, 'ascii');
  buffer.writeUInt16LE(0x20b, PE_START + 4 + 20);
  buffer.writeUInt16LE(subsystem, FIELD);
  return buffer;
}

describe('subsystemOffset', () => {
  it('locates field in valid image', () => {
    assert.equal(subsystemOffset(fakePE()), FIELD);
  });
  it('rejects garbage, truncation, and 32-bit images', () => {
    assert.equal(subsystemOffset(Buffer.from('hello')), -1);
    assert.equal(subsystemOffset(fakePE().subarray(0, 10)), -1);
    const pe32 = fakePE();
    pe32.writeUInt16LE(0x10b, PE_START + 4 + 20);
    assert.equal(subsystemOffset(pe32), -1);
  });
});

describe('withGuiSubsystem', () => {
  it('flips copy to GUI, leaves input intact', () => {
    const before = fakePE();
    const after = withGuiSubsystem(before);
    assert.equal(readSubsystem(after), IMAGE_SUBSYSTEM_WINDOWS_GUI);
    assert.equal(readSubsystem(before), IMAGE_SUBSYSTEM_WINDOWS_CUI);
  });
  it('throws on non-PE input', () => {
    assert.throws(() => withGuiSubsystem(Buffer.from('hello')), /64-bit/);
  });
});

describe('setGuiSubsystem', () => {
  it('patches file and reports previous value', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-pe-'));
    const path = join(dir, 'app.exe');
    await writeFile(path, fakePE());
    assert.equal(await setGuiSubsystem(path), IMAGE_SUBSYSTEM_WINDOWS_CUI);
    assert.equal(readSubsystem(await readFile(path)), IMAGE_SUBSYSTEM_WINDOWS_GUI);
    assert.equal(await setGuiSubsystem(path), IMAGE_SUBSYSTEM_WINDOWS_GUI);
  });
});
