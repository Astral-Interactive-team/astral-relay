// Production runtime config tests. Order: appended payload with
// token, then embedded copy. No config.json or sidecar is read,
// written, or required. Legacy files beside the binary are ignored.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRuntimeConfig } from '../src/shared/config.js';

const agentDir = fileURLToPath(new URL('../src/agent/', import.meta.url));
const embeddedPath = join(agentDir, 'embedded-config.json');
let stagedEmbedded = false;

const TOKEN = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.abcdef.GHIJKLMNOPQRSTUVWXYZ012345';

function good() {
  return {
    requiredPermission: 'ManageGuild',
    enabledCommands: ['status'],
    agentVersion: '9.9.9',
  };
}

let loadProductionConfig;
let handleVersionFlag;
let runAgent;

before(async () => {
  try {
    await writeFile(embeddedPath, JSON.stringify(defaultRuntimeConfig()));
    stagedEmbedded = true;
  } catch {
    // Builder staging already present; reuse as-is.
  }
  ({ loadProductionConfig, handleVersionFlag, runAgent } = await import('../src/agent/index.js'));
});

after(async () => {
  if (stagedEmbedded) {
    await rm(embeddedPath, { force: true });
  }
});

describe('loadProductionConfig', () => {
  it('loads token plus config from appended payload', async () => {
    const { appendProductionPayload } = await import('../src/agent/payload.js');
    const dir = await mkdtemp(join(tmpdir(), 'relay-prod-'));
    const exe = join(dir, 'fake.exe');
    await writeFile(exe, Buffer.alloc(1024, 0));
    await appendProductionPayload(exe, TOKEN, good());
    const { token, config } = await loadProductionConfig(exe);
    assert.equal(token, TOKEN);
    assert.equal(config.agentVersion, '9.9.9');
  });
  it('fails closed with rebuild hint when payload absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-prod-'));
    const exe = join(dir, 'fake.exe');
    await writeFile(exe, Buffer.alloc(1024, 0));
    await assert.rejects(() => loadProductionConfig(exe), /Rebuild the EXE/);
  });
  it('fails closed on tokenless legacy payload', async () => {
    const { appendPayload } = await import('../src/agent/payload.js');
    const dir = await mkdtemp(join(tmpdir(), 'relay-prod-'));
    const exe = join(dir, 'fake.exe');
    await writeFile(exe, Buffer.alloc(1024, 0));
    await appendPayload(exe, good());
    await assert.rejects(() => loadProductionConfig(exe), /Rebuild the EXE/);
  });
  it('ignores legacy sidecar and config.json files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-prod-'));
    await writeFile(join(dir, 'agent-config.json'), JSON.stringify(good()));
    await writeFile(join(dir, 'config.json'), JSON.stringify(good()));
    await assert.rejects(
      loadProductionConfig(join(dir, 'fake.exe')),
      /Rebuild the EXE/,
    );
  });
  it('creates no sidecar files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-prod-'));
    const exe = join(dir, 'fake.exe');
    await writeFile(exe, Buffer.alloc(1024, 0));
    await assert.rejects(() => loadProductionConfig(exe));
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(dir), ['fake.exe']);
  });
});

describe('handleVersionFlag', () => {
  it('prints given version', () => {
    assert.equal(handleVersionFlag(['--version'], '9.9.9'), true);
    assert.equal(handleVersionFlag([], '9.9.9'), false);
  });
});

describe('runAgent token handling', () => {
  it('rejects empty token without touching network', async () => {
    let called = false;
    await assert.rejects(
      runAgent({ token: '   ', config: good(), login: async () => ((called = true), null) }),
      /Empty token/,
    );
    assert.equal(called, false);
  });
  it('passes token into starter closure', async () => {
    let seenToken = null;
    const fakeClient = { destroy: async () => {} };
    const out = await runAgent({
      token: '  secret-token-xyz ',
      config: good(),
      login: async (fn) => fn(),
      start: async (config, token) => {
        seenToken = token;
        return fakeClient;
      },
    });
    assert.equal(out, fakeClient);
    assert.equal(seenToken, 'secret-token-xyz');
  });
  it('converts auth rejection to token-free error', async () => {
    const authFail = new Error('An invalid token was provided.');
    await assert.rejects(
      runAgent({ token: 'bad-token', config: good(), login: async () => { throw authFail; } }),
      /rejected the embedded token/,
    );
  });
  it('imports no development UI modules', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(join(agentDir, 'index.js'), 'utf8');
    assert.ok(!source.includes('startup-menu'));
    assert.ok(!source.includes('secure-input'));
    assert.ok(!source.includes('cli/menu'));
  });
});
