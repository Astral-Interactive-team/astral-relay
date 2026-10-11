// Template freshness fingerprint for cached Agent builds.
// Covers every input that shapes the packaged binary: agent and
// shared sources, root package.json, lockfile when present, target
// runtime version, and packager version. CLI and builder sources
// are excluded on purpose: the snapshot only holds files reachable
// from the agent entry, so editing them must not bust the cache.

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const HASH_FILES = ['package.json', 'package-lock.json'];

// Collects files under dir recursively, sorted for stable hashing.
async function collect(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collect(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
}

// Hashes file bytes into digest. Missing files contribute nothing,
// so fresh checkouts and sparse trees behave identically.
async function hashInto(digest, path) {
  try {
    const data = await readFile(path);
    digest.update(path);
    digest.update(data);
  } catch {
    // Optional file absent; skip without failing.
  }
}

// Reads JSON version field, empty string when unreadable.
async function depVersion(root, name) {
  try {
    const raw = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8'));
    return String(raw.version || '');
  } catch {
    return '';
  }
}

// Computes fingerprint string for repo root. Changes when agent
// code, shared code, manifests, runtime, or packager change.
export async function computeFingerprint(root) {
  const digest = createHash('sha256');
  const sources = [];
  await collect(join(root, 'src', 'agent'), sources);
  await collect(join(root, 'src', 'shared'), sources);
  sources.sort();
  for (const file of sources) {
    await hashInto(digest, file);
  }
  for (const name of HASH_FILES) {
    await hashInto(digest, join(root, name));
  }
  digest.update(process.version);
  digest.update(await depVersion(root, '@yao-pkg/pkg'));
  digest.update(await depVersion(root, 'discord.js'));
  return digest.digest('hex');
}

// Loads stored fingerprint record, null when absent or unreadable.
export async function loadFingerprint(path) {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8'));
    return typeof raw.fingerprint === 'string' ? raw : null;
  } catch {
    return null;
  }
}

// Stores fingerprint record beside template.
export async function saveFingerprint(path, fingerprint) {
  const record = { fingerprint, nodeVersion: process.version, createdAt: new Date().toISOString() };
  await writeFile(path, JSON.stringify(record, null, 2) + '\n', 'utf8');
  return record;
}

// Returns true when stored record matches live tree.
export async function isFresh(path, root) {
  const stored = await loadFingerprint(path);
  if (stored === null) {
    return false;
  }
  return stored.fingerprint === (await computeFingerprint(root));
}

// Lists fingerprinted source files. Exported for tests.
export async function fingerprintedSources(root) {
  const sources = [];
  await collect(join(root, 'src', 'agent'), sources);
  await collect(join(root, 'src', 'shared'), sources);
  return sources.sort();
}
