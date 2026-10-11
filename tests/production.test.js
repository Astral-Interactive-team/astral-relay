// Production payload and build-token tests. Temp blobs stand in
// for binaries in unit paths; two end-to-end builds run the real
// warm pipeline (template cache required) with fake tokens only.
// Covers token shape, production roundtrip, prompt injection,
// fast abort, output preservation, and secret-free artifacts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  appendProductionPayload,
  buildProductionPayload,
  isPlausibleBotToken,
  readPayload,
} from '../src/agent/payload.js';
import { buildAgent, resolveBuildToken } from '../src/builder/build-agent.js';
import { defaultRuntimeConfig } from '../src/shared/config.js';

const TOKEN_A = 'QUJDREVGR0hJSktMTU5PUFFS.VEVTVC1BLVRPS0VO.MTIzNDU2Nzg5MEFCQ0RFRkdI';
const TOKEN_B = 'QUJDREVGR0hJSktMTU5PUFFS.VEVTVC1CLVRPS0VO.TUVORVNSUVFPOTAwNzg5MGFi';

function defaults() {
  return { ...defaultRuntimeConfig(), agentVersion: '0.1.0' };
}

async function fakeExe() {
  const dir = await mkdtemp(join(tmpdir(), 'relay-prod-'));
  const path = join(dir, 'app.exe');
  await writeFile(path, Buffer.alloc(4096, 0x4d));
  return path;
}

const noPrompt = async () => {
  throw new Error('prompt must not run');
};

describe('isPlausibleBotToken', () => {
  it('accepts three-part bot tokens', () => {
    assert.equal(isPlausibleBotToken(TOKEN_A), true);
    assert.equal(isPlausibleBotToken('  ' + TOKEN_A + '  '), true);
  });
  it('rejects empty, partial, and non-string input', () => {
    for (const bad of ['', '   ', 'nodots', 'a.b', 'x.y', null, undefined, 42]) {
      assert.equal(isPlausibleBotToken(bad), false, JSON.stringify(bad));
    }
  });
});

describe('buildProductionPayload', () => {
  it('roundtrips token plus config', async () => {
    const path = await fakeExe();
    await appendProductionPayload(path, TOKEN_A, defaults());
    const found = await readPayload(path);
    assert.equal(found.token, TOKEN_A);
    assert.deepEqual(found.config, defaults());
  });
  it('trims surrounding whitespace', async () => {
    const path = await fakeExe();
    await appendProductionPayload(path, '  ' + TOKEN_A + '\n', defaults());
    assert.equal((await readPayload(path)).token, TOKEN_A);
  });
  it('rejects malformed tokens and bad config', () => {
    assert.throws(() => buildProductionPayload('junk', defaults()), /shape/);
    assert.throws(() => buildProductionPayload(TOKEN_A, { requiredPermission: 'Nope' }), /invalid/);
  });
  it('produces different bytes per token', async () => {
    const first = await fakeExe();
    const second = await fakeExe();
    await appendProductionPayload(first, TOKEN_A, defaults());
    await appendProductionPayload(second, TOKEN_B, defaults());
    const hash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
    assert.notEqual(await hash(first), await hash(second));
  });
});

describe('resolveBuildToken', () => {
  it('passes argument through trimmed', async () => {
    assert.equal(await resolveBuildToken({ token: '  ' + TOKEN_A + ' ', promptToken: noPrompt }), TOKEN_A);
  });
  it('prompts exactly once when omitted', async () => {
    let calls = 0;
    const token = await resolveBuildToken({
      promptToken: async () => {
        calls += 1;
        return TOKEN_A;
      },
    });
    assert.equal(token, TOKEN_A);
    assert.equal(calls, 1);
  });
  it('rejects invalid input without packaging', async () => {
    await assert.rejects(() => resolveBuildToken({ token: 'junk', promptToken: noPrompt }), /shape/);
    await assert.rejects(() => resolveBuildToken({ promptToken: async () => '' }), /shape/);
  });
});

describe('token-embedding builds', () => {
  it('embeds valid token end-to-end without prompting', async () => {
    const result = await buildAgent({ token: TOKEN_A, promptToken: noPrompt });
    const found = await readPayload(result.exePath);
    assert.equal(found.token, TOKEN_A);
    assert.ok(result.versionLine.includes('AstralRelay-Agent'));
  });
  it('token change produces different executable', async () => {
    const first = await buildAgent({ token: TOKEN_A, promptToken: noPrompt });
    const hashA = createHash('sha256').update(await readFile(first.exePath)).digest('hex');
    const second = await buildAgent({ token: TOKEN_B, promptToken: noPrompt });
    const hashB = createHash('sha256').update(await readFile(second.exePath)).digest('hex');
    assert.notEqual(hashA, hashB);
    assert.equal((await readPayload(second.exePath)).token, TOKEN_B);
  });
  it('invalid token aborts fast and preserves output', async () => {
    const exePath = join(process.cwd(), 'dist', 'AstralRelay-Agent.exe');
    let before = null;
    try {
      before = (await stat(exePath)).mtimeMs;
    } catch {
      before = null;
    }
    await assert.rejects(() => buildAgent({ token: 'junk', promptToken: noPrompt }), /shape/);
    if (before !== null) {
      assert.equal((await stat(exePath)).mtimeMs, before);
    }
  });
  it('leaks no token into logs, fingerprint, or temp names', async () => {
    const { readdir } = await import('node:fs/promises');
    const logs = (await readdir(join(process.cwd(), 'dist'))).filter((name) => name.startsWith('build-'));
    for (const name of logs.slice(-2)) {
      const text = await readFile(join(process.cwd(), 'dist', name), 'utf8');
      assert.ok(!text.includes(TOKEN_A) && !text.includes(TOKEN_B));
    }
    const record = await readFile(join(process.cwd(), 'build-cache', 'template.json'), 'utf8');
    assert.ok(!record.includes(TOKEN_A) && !record.includes(TOKEN_B));
    const leftovers = (await readdir(join(process.cwd(), 'dist'))).filter((name) => name.startsWith('.agent-tmp-'));
    assert.deepEqual(leftovers, []);
  });
});
