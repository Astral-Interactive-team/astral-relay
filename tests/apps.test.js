// Discovery, catalog, Unicode parser, and launcher tests. spawn is
// an injected fake so no real process starts. Temp dirs hold crafted
// .lnk bytes, so parser and discovery run without Windows present.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverCatalog,
  formatAppsList,
  getStartMenuDirs,
  launchApp,
  needsNativeResolve,
  parseLnkTarget,
  resolveAnsiTargets,
  resolveById,
  searchCatalog,
  stableId,
  toAutocompleteChoices,
} from '../src/agent/windows/apps.js';

// Builds minimal .lnk bytes with Unicode LinkInfo fields (header 36).
// ansiPath fills legacy ANSI slots to prove Unicode wins on read.
function makeLnkUnicode(localPath, suffix = '', ansiPath = null) {
  const uni = Buffer.from(localPath + '\0', 'utf16le');
  const uniExtra = suffix === '' ? Buffer.alloc(0) : Buffer.from(suffix + '\0', 'utf16le');
  const ansi = Buffer.from((ansiPath || '') + '\0', 'latin1');
  const ansiOffset = ansiPath === null ? 0 : 36;
  const uniOffset = ansiPath === null ? 36 : 36 + ansi.length;
  const uniSuffixOffset = suffix === '' ? 0 : uniOffset + uni.length;
  const infoSize = (suffix === '' ? uniOffset + uni.length : uniSuffixOffset + uniExtra.length);
  const header = Buffer.alloc(76, 0);
  header.writeUInt32LE(0x4c, 0);
  header.writeUInt32LE(0x02, 20);
  const info = Buffer.alloc(infoSize, 0);
  info.writeUInt32LE(infoSize, 0);
  info.writeUInt32LE(36, 4);
  info.writeUInt32LE(0x01, 8);
  info.writeUInt32LE(ansiOffset, 16);
  uni.copy(info, uniOffset);
  if (uniExtra.length > 0) {
    uniExtra.copy(info, uniSuffixOffset);
  }
  info.writeUInt32LE(uniOffset, 28);
  info.writeUInt32LE(uniSuffixOffset, 32);
  if (ansiPath !== null) {
    ansi.copy(info, ansiOffset);
  }
  return Buffer.concat([header, info]);
}

// Builds legacy ANSI-only .lnk bytes (header 28, no Unicode fields).
function makeLnkAnsi(localPath) {
  const local = Buffer.from(localPath + '\0', 'latin1');
  const header = Buffer.alloc(76, 0);
  header.writeUInt32LE(0x4c, 0);
  header.writeUInt32LE(0x02, 20);
  const info = Buffer.alloc(28 + local.length, 0);
  info.writeUInt32LE(28 + local.length, 0);
  info.writeUInt32LE(28, 4);
  info.writeUInt32LE(0x01, 8);
  info.writeUInt32LE(28, 16);
  local.copy(info, 28);
  return Buffer.concat([header, info]);
}

describe('parseLnkTarget', () => {
  it('reads Unicode local base path', () => {
    assert.equal(parseLnkTarget(makeLnkUnicode('C:\\Tools\\app.exe')), 'C:\\Tools\\app.exe');
  });
  it('reads Korean Unicode target exactly', () => {
    const target = 'C:\\사용자\\도구\\앱.exe';
    assert.equal(parseLnkTarget(makeLnkUnicode(target)), target);
  });
  it('reads Korean shortcut Unicode suffix', () => {
    assert.equal(parseLnkTarget(makeLnkUnicode('C:\\도구', '실행.exe')), 'C:\\도구\\실행.exe');
  });
  it('prefers Unicode over ANSI bytes', () => {
    const bytes = makeLnkUnicode('C:\\진짜\\app.exe', '', 'C:\\wrong\\app.exe');
    assert.equal(parseLnkTarget(bytes), 'C:\\진짜\\app.exe');
  });
  it('returns null for ANSI-only legacy shortcuts', () => {
    assert.equal(parseLnkTarget(makeLnkAnsi('C:\\Tools\\app.exe')), null);
  });
  it('returns null for out-of-bounds Unicode offsets', () => {
    const bytes = makeLnkUnicode('C:\\Tools\\app.exe');
    bytes.writeUInt32LE(9000, 76 + 28);
    assert.equal(parseLnkTarget(bytes), null);
  });
  it('returns null for truncated and garbage buffers', () => {
    const full = makeLnkUnicode('C:\\Tools\\app.exe');
    assert.equal(parseLnkTarget(full.subarray(0, 40)), null);
    assert.equal(parseLnkTarget(Buffer.from('hello')), null);
    assert.equal(parseLnkTarget(null), null);
  });
});

describe('needsNativeResolve', () => {
  it('flags ANSI-only legacy shortcuts', () => {
    assert.equal(needsNativeResolve(makeLnkAnsi('C:\\Tools\\app.exe')), true);
  });
  it('clears Unicode and malformed shortcuts', () => {
    assert.equal(needsNativeResolve(makeLnkUnicode('C:\\Tools\\app.exe')), false);
    assert.equal(needsNativeResolve(Buffer.from('hello')), false);
  });
});

// Fake spawn child scripting stdout lines then close event.
function fakeSpawn(lines, { fail = false, hang = false } = {}) {
  return () => {
    if (fail) {
      throw new Error('no powershell');
    }
    const handlers = {};
    const child = {
      stdout: { on: (event, fn) => { handlers[event] = fn; } },
      stdin: { write: () => {}, end: () => {} },
      kill: () => {},
      on: (event, fn) => { handlers[event] = fn; },
    };
    queueMicrotask(() => {
      if (hang) {
        return;
      }
      if (handlers.data) {
        handlers.data(lines.join('\n'));
      }
      if (handlers.close) {
        handlers.close(0);
      }
    });
    return child;
  };
}

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

describe('resolveAnsiTargets', () => {
  it('maps base64 lines to targets', async () => {
    const lines = [`${b64('C:\\A\\x.lnk')} ${b64('C:\\Tools\\x.exe')}`, `${b64('C:\\B\\y.lnk')} `];
    const map = await resolveAnsiTargets(['C:\\A\\x.lnk', 'C:\\B\\y.lnk'], fakeSpawn(lines));
    assert.equal(map.get('C:\\A\\x.lnk'), 'C:\\Tools\\x.exe');
    assert.equal(map.get('C:\\B\\y.lnk'), '');
  });
  it('skips corrupt lines without failing batch', async () => {
    const map = await resolveAnsiTargets(['C:\\A\\x.lnk'], fakeSpawn(['not-base64-here', `${b64('C:\\A\\x.lnk')} ${b64('T')}`]));
    assert.equal(map.get('C:\\A\\x.lnk'), 'T');
  });
  it('returns empty map on spawn failure and timeout', async () => {
    assert.equal((await resolveAnsiTargets(['C:\\A\\x.lnk'], fakeSpawn([], { fail: true }))).size, 0);
    assert.equal((await resolveAnsiTargets(['C:\\A\\x.lnk'], fakeSpawn([], { hang: true }), 30)).size, 0);
  });
  it('never spawns for empty input', async () => {
    let called = false;
    const map = await resolveAnsiTargets([], () => ((called = true), null));
    assert.equal(map.size, 0);
    assert.equal(called, false);
  });
});

describe('stableId', () => {
  it('is deterministic and case-insensitive', () => {
    assert.equal(stableId('C:\\A\\x.lnk'), stableId('c:\\a\\X.LNK'));
    assert.equal(stableId('C:\\A\\x.lnk').length, 12);
  });
});

describe('discoverCatalog', () => {
  it('lists Unicode shortcuts, resolves ANSI-only via injected lookup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-apps-'));
    await writeFile(join(dir, 'Good.lnk'), makeLnkUnicode('C:\\Tools\\good.exe'));
    await writeFile(join(dir, 'Legacy.lnk'), makeLnkAnsi('C:\\Tools\\legacy.exe'));
    await writeFile(join(dir, 'Broken.lnk'), Buffer.from('junk-bytes-here-padded-00000000000000000000000000000000'));
    const fakeResolve = async (paths) => new Map([[join(dir, 'Legacy.lnk'), 'C:\\Tools\\legacy.exe']]);
    const result = await discoverCatalog([dir], { resolveAnsi: fakeResolve });
    assert.equal(result.apps.length, 2);
    assert.equal(result.skipped, 1);
    const legacy = result.apps.find((a) => a.name === 'Legacy');
    assert.equal(legacy.target, 'C:\\Tools\\legacy.exe');
  });
  it('marks unresolvable shortcuts unavailable, never launches them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-unres-'));
    await writeFile(join(dir, 'Stuck.lnk'), makeLnkAnsi('C:\\Tools\\stuck.exe'));
    const result = await discoverCatalog([dir], { resolveAnsi: async () => new Map() });
    assert.equal(result.apps.length, 1);
    assert.equal(result.apps[0].target, null);
    assert.equal(result.apps[0].available, false);
    assert.equal(result.apps[0].unresolved, true);
    await assert.rejects(() => launchApp(result.apps[0], () => ({ unref() {} })), /reliably/);
  });
  it('keeps stable IDs across rescans', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-stable-'));
    await mkdir(join(dir, 'Tools'), { recursive: true });
    await writeFile(join(dir, 'Tools', 'Good.lnk'), makeLnkUnicode('C:\\Tools\\good.exe'));
    const first = await discoverCatalog([dir], { resolveAnsi: async () => new Map() });
    const second = await discoverCatalog([dir], { resolveAnsi: async () => new Map() });
    assert.equal(second.apps[0].id, first.apps[0].id);
  });
  it('returns empty for missing folders', async () => {
    const result = await discoverCatalog([join(tmpdir(), 'relay-nope-missing')]);
    assert.deepEqual(result.apps, []);
  });
});

describe('getStartMenuDirs', () => {
  it('builds both scopes from env', () => {
    const dirs = getStartMenuDirs({ ProgramData: 'C:\\PD', APPDATA: 'C:\\ROAM' });
    assert.equal(dirs.length, 2);
    assert.ok(dirs[0].includes('Start Menu'));
  });
  it('returns empty without env', () => {
    assert.deepEqual(getStartMenuDirs({}), []);
  });
});

const catalog = [
  { id: 'a1', name: 'Notepad', folder: '.', scope: 'all-users', shortcut: 'x', target: 'C:\\W\\n.exe', available: true },
  { id: 'b2', name: 'Notepad', folder: 'Tools', scope: 'per-user', shortcut: 'y', target: 'C:\\T\\n.exe', available: false },
  { id: 'c3', name: 'Calc', folder: '.', scope: 'all-users', shortcut: 'z', target: 'C:\\W\\c.exe', available: true },
];

describe('resolveById', () => {
  it('resolves only exact IDs, never names', () => {
    assert.equal(resolveById(catalog, 'a1').target, 'C:\\W\\n.exe');
    assert.equal(resolveById(catalog, 'Notepad'), null);
    assert.equal(resolveById(catalog, 'zzz'), null);
  });
});

describe('searchCatalog', () => {
  it('filters case-insensitively, caps limit', () => {
    assert.equal(searchCatalog(catalog, 'note').length, 2);
    assert.equal(searchCatalog(catalog, '').length, 3);
    assert.equal(searchCatalog(catalog, '', 1).length, 1);
    assert.equal(searchCatalog(null, 'x').length, 0);
  });
});

describe('toAutocompleteChoices', () => {
  it('carries IDs as values and disambiguates duplicates', () => {
    const choices = toAutocompleteChoices(searchCatalog(catalog, 'note'));
    assert.equal(choices.length, 2);
    assert.ok(choices.every((c) => ['a1', 'b2'].includes(c.value)));
    assert.ok(choices.some((c) => c.name.includes('Tools')));
  });
  it('truncates labels over 100 chars', () => {
    const long = [{ id: 'x', name: 'N'.repeat(120), folder: '.', target: 't' }];
    assert.ok(toAutocompleteChoices(long)[0].name.length <= 100);
  });
});

describe('formatAppsList', () => {
  it('marks unavailable and reports overflow', () => {
    const text = formatAppsList(catalog.slice(0, 2), 30);
    assert.ok(text.includes('[unavailable]'));
    assert.ok(text.includes('more'));
  });
  it('handles empty results', () => {
    assert.ok(formatAppsList([], 0).includes('No applications'));
  });
});

describe('launchApp', () => {
  it('rejects unknown entry without spawning', async () => {
    let called = false;
    await assert.rejects(
      () => launchApp(null, () => ((called = true), { unref() {} })),
      /Unknown application/,
    );
    assert.equal(called, false);
  });
  it('blocks traversal and non-exe without spawning', async () => {
    let called = false;
    const fake = () => ((called = true), { unref() {} });
    await assert.rejects(() => launchApp({ name: 'Evil', target: 'C:\\x\\..\\e.exe' }, fake), /Blocked unsafe/);
    await assert.rejects(() => launchApp({ name: 'Bat', target: 'C:\\x\\run.bat' }, fake), /Blocked unsafe/);
    assert.equal(called, false);
  });
  it('rejects missing target file', async () => {
    await assert.rejects(
      () => launchApp({ name: 'Ghost', target: 'C:\\definitely\\not\\here-ghost.exe' }, () => ({ unref() {} })),
      /missing/,
    );
  });
  it('spawns real temp file shell-free with no args', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-exe-'));
    const target = join(dir, 'tool.exe');
    await writeFile(target, 'fake');
    let seen = null;
    const fake = (file, args, opts) => ((seen = { file, args, opts }), { unref() {} });
    const name = await launchApp({ name: 'Tool', target }, fake);
    assert.equal(name, 'Tool');
    assert.deepEqual(seen.args, []);
    assert.equal(seen.opts.shell, false);
  });
});
