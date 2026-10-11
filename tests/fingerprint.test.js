// Fingerprint freshness tests. Temp trees stand in for repo root:
// stability, source sensitivity, and manifest sensitivity behave
// identically without touching real sources.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeFingerprint,
  fingerprintedSources,
  isFresh,
  loadFingerprint,
  saveFingerprint,
} from '../src/builder/fingerprint.js';

async function fakeRoot() {
  const root = await mkdtemp(join(tmpdir(), 'relay-fp-'));
  await mkdir(join(root, 'src', 'agent'), { recursive: true });
  await mkdir(join(root, 'src', 'shared'), { recursive: true });
  await writeFile(join(root, 'src', 'agent', 'a.js'), 'one');
  await writeFile(join(root, 'src', 'shared', 'b.js'), 'two');
  await writeFile(join(root, 'package.json'), '{"name":"x"}');
  return root;
}

describe('computeFingerprint', () => {
  it('is stable across runs', async () => {
    const root = await fakeRoot();
    assert.equal(await computeFingerprint(root), await computeFingerprint(root));
  });
  it('changes on agent source edits', async () => {
    const root = await fakeRoot();
    const before = await computeFingerprint(root);
    await writeFile(join(root, 'src', 'agent', 'a.js'), 'changed');
    assert.notEqual(await computeFingerprint(root), before);
  });
  it('changes on manifest edits', async () => {
    const root = await fakeRoot();
    const before = await computeFingerprint(root);
    await writeFile(join(root, 'package.json'), '{"name":"y"}');
    assert.notEqual(await computeFingerprint(root), before);
  });
  it('lists agent and shared sources', async () => {
    const root = await fakeRoot();
    const sources = await fingerprintedSources(root);
    assert.equal(sources.length, 2);
  });
});

describe('fingerprint records', () => {
  it('roundtrips save and load', async () => {
    const root = await fakeRoot();
    const path = join(root, 'template.json');
    await saveFingerprint(path, await computeFingerprint(root));
    const loaded = await loadFingerprint(path);
    assert.ok(loaded.fingerprint.length > 0);
  });
  it('reports fresh only on match', async () => {
    const root = await fakeRoot();
    const path = join(root, 'template.json');
    assert.equal(await isFresh(path, root), false);
    await saveFingerprint(path, await computeFingerprint(root));
    assert.equal(await isFresh(path, root), true);
    await writeFile(join(root, 'src', 'shared', 'b.js'), 'changed');
    assert.equal(await isFresh(path, root), false);
  });
  it('returns null for missing record', async () => {
    assert.equal(await loadFingerprint(join(tmpdir(), 'relay-nope.json')), null);
  });
});
