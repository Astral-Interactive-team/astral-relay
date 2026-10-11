// Appended payload tests. Temp binary blobs stand in for EXE:
// layout math is identical, no packaging run needed. Covers
// roundtrip, absent footer, truncation, tampering, version, size,
// schema rejection, and data-only shape.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_PAYLOAD_BYTES,
  PAYLOAD_MAGIC,
  appendPayload,
  buildPayload,
  readPayload,
  stripPayload,
} from '../src/agent/payload.js';

function good() {
  return {
    requiredPermission: 'ManageGuild',
    enabledCommands: ['status', 'open', 'apps', 'lock'],
    agentVersion: '0.1.0',
  };
}

async function fakeExe() {
  const dir = await mkdtemp(join(tmpdir(), 'relay-pe-'));
  const path = join(dir, 'app.exe');
  await writeFile(path, Buffer.alloc(4096, 0x4d));
  return path;
}

describe('payload roundtrip', () => {
  it('appends and reads back identical config', async () => {
    const path = await fakeExe();
    await appendPayload(path, good());
    const found = await readPayload(path);
    assert.deepEqual(found.config, good());
    assert.equal(found.version, 1);
  });
  it('returns null when no footer present', async () => {
    assert.equal(await readPayload(await fakeExe()), null);
  });
  it('holds data only, no executable code', async () => {
    const path = await fakeExe();
    await appendPayload(path, good());
    const found = await readPayload(path);
    assert.equal(typeof found.config, 'object');
    assert.ok(!('code' in found.config || 'run' in found.config));
  });
  it('strips back to plain template', async () => {
    const path = await fakeExe();
    await appendPayload(path, good());
    assert.equal(await stripPayload(path), true);
    assert.equal(await readPayload(path), null);
    assert.equal(await stripPayload(path), false);
  });
});

describe('payload rejection', () => {
  it('rejects truncated body with inflated length', async () => {
    const path = await fakeExe();
    const body = Buffer.from(JSON.stringify({ v: 1, config: good() }), 'utf8');
    const footer = Buffer.alloc(12);
    footer.writeUInt32LE(body.length + 5000, 0);
    footer.write(PAYLOAD_MAGIC, 4, 'ascii');
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'a');
    await handle.writeFile(Buffer.concat([body, footer]));
    await handle.close();
    await assert.rejects(() => readPayload(path), /corrupt|length/);
  });
  it('treats cut-off magic as absent payload', async () => {
    const path = await fakeExe();
    await appendPayload(path, good());
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'r+');
    const meta = await handle.stat();
    await handle.truncate(meta.size - 3);
    await handle.close();
    assert.equal(await readPayload(path), null);
  });
  it('rejects tampered length', async () => {
    const path = await fakeExe();
    await appendPayload(path, good());
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'r+');
    const meta = await handle.stat();
    const bad = Buffer.alloc(12);
    bad.writeUInt32LE(MAX_PAYLOAD_BYTES + 1, 0);
    bad.write(PAYLOAD_MAGIC, 4, 'ascii');
    await handle.write(bad, 0, 12, meta.size - 12);
    await handle.close();
    await assert.rejects(() => readPayload(path), /corrupt/);
  });
  it('rejects tampered JSON body', async () => {
    const path = await fakeExe();
    await appendPayload(path, good());
    const { open, readFile } = await import('node:fs/promises');
    const data = await readFile(path);
    const length = data.readUInt32LE(data.length - 12);
    const handle = await open(path, 'r+');
    await handle.write(Buffer.from('XXXXX'), 0, 5, data.length - 12 - length + 10);
    await handle.close();
    await assert.rejects(() => readPayload(path), /corrupt|invalid/);
  });
  it('rejects unknown version', async () => {
    const path = await fakeExe();
    const body = Buffer.from(JSON.stringify({ v: 999, config: good() }), 'utf8');
    const footer = Buffer.alloc(12);
    footer.writeUInt32LE(body.length, 0);
    footer.write(PAYLOAD_MAGIC, 4, 'ascii');
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'a');
    await handle.writeFile(Buffer.concat([body, footer]));
    await handle.close();
    await assert.rejects(() => readPayload(path), /version/);
  });
  it('rejects schema-invalid config at build and read', async () => {
    assert.throws(() => buildPayload({ ...good(), guildId: 'bad' }), /invalid/);
    const path = await fakeExe();
    const body = Buffer.from(JSON.stringify({ v: 1, config: { ...good(), guildId: 'bad' } }), 'utf8');
    const footer = Buffer.alloc(12);
    footer.writeUInt32LE(body.length, 0);
    footer.write(PAYLOAD_MAGIC, 4, 'ascii');
    const { open } = await import('node:fs/promises');
    const handle = await open(path, 'a');
    await handle.writeFile(Buffer.concat([body, footer]));
    await handle.close();
    await assert.rejects(() => readPayload(path), /invalid/);
  });
  it('rejects token fields in payload', () => {
    assert.throws(() => buildPayload({ ...good(), botToken: 'x' }), /invalid/);
  });
});
