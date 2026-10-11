// Windows application discovery and safe launcher for /pc open.
// Catalog comes from Start Menu shortcuts (*.lnk) in the all-users
// and per-user Programs folders, parsed locally on every use, so no
// configuration list is needed and any install count works.
//
// Supported: shortcuts whose target is a local .exe file, resolved
// from Unicode LinkInfo fields when present, else through a single
// Windows-native WScript.Shell batch lookup per scan.
// Skipped safely: Store/UWP apps, URLs, GUID shell objects, Control
// Panel applets, broken links, and targets that are not .exe files.
// Shortcuts whose path cannot be resolved reliably stay listed as
// unavailable and are never launched.
// Inaccessible files and missing folders never fail discovery; the
// entry is skipped or marked unavailable.
//
// Identity: each entry carries a stable ID (hash of shortcut path),
// so Discord autocomplete values resolve server-side. Display names
// from users are never trusted; free-typed text matching no ID is
// rejected. Launch re-validates the target and stats the file on
// every call, then spawns detached without shell and without
// accepting remote command-line arguments.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';

const LNK_EXT = '.lnk';
const EXE_EXT = '.exe';
const AUTOCOMPLETE_LIMIT = 25;
const LIST_LIMIT = 15;

// Returns Start Menu Programs folders to scan. Env injectable for tests.
export function getStartMenuDirs(env = process.env) {
  const dirs = [];
  if (env.ProgramData) {
    dirs.push(join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  if (env.APPDATA) {
    dirs.push(join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  }
  return dirs;
}

// Hashes shortcut path into short stable ID. Lowercases first so
// case-only path differences map to one entry.
export function stableId(shortcutPath) {
  return createHash('sha1').update(String(shortcutPath).toLowerCase()).digest('hex').slice(0, 12);
}

// Extracts local target path from .lnk bytes (MS-SHLLINK LinkInfo).
// Prefers Unicode fields (LocalBasePathOffsetUnicode /
// CommonPathSuffixOffsetUnicode, present when header size >= 36)
// decoded as UTF-16LE. Legacy ANSI bytes are never decoded here:
// arbitrary code pages make Latin-1 a lie, so ANSI-only shortcuts
// return null and go through the Windows-native resolver instead.
// Returns absolute path string or null when no reliable Unicode
// target exists or bytes are malformed. Bounds-checked throughout.
export function parseLnkTarget(buffer) {
  const info = readLinkInfo(buffer);
  if (info === null) {
    return null;
  }
  const base = info.unicodeBase;
  if (base === '') {
    return null;
  }
  if (info.unicodeSuffix !== '' && !base.endsWith('\\')) {
    return base + '\\' + info.unicodeSuffix;
  }
  return base + info.unicodeSuffix;
}

// Reports whether shortcut bytes hold ANSI-only local target with
// no usable Unicode fields. Used to queue Windows-native resolution.
export function needsNativeResolve(buffer) {
  const info = readLinkInfo(buffer);
  if (info === null) {
    return false;
  }
  return info.unicodeBase === '' && info.hasAnsiBase;
}

// Parses LinkInfo structure shared by unicode/ansi probes. Returns
// {unicodeBase, unicodeSuffix, hasAnsiBase} or null when absent or
// malformed. Never throws.
function readLinkInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 78) {
    return null;
  }
  if (buffer.readUInt32LE(0) !== 0x4c) {
    return null;
  }
  const flags = buffer.readUInt32LE(20);
  const HAS_ID_LIST = 0x01;
  const HAS_LINK_INFO = 0x02;
  let pos = 76;
  if (flags & HAS_ID_LIST) {
    if (pos + 2 > buffer.length) {
      return null;
    }
    pos += 2 + buffer.readUInt16LE(pos);
  }
  if (!(flags & HAS_LINK_INFO)) {
    return null;
  }
  if (pos + 28 > buffer.length) {
    return null;
  }
  const infoSize = buffer.readUInt32LE(pos);
  const infoHeader = buffer.readUInt32LE(pos + 4);
  if (infoSize < 28 || infoHeader < 28 || pos + infoSize > buffer.length) {
    return null;
  }
  const infoFlags = buffer.readUInt32LE(pos + 8);
  const VOLUME_AND_LOCAL = 0x01;
  if (!(infoFlags & VOLUME_AND_LOCAL)) {
    return null;
  }
  const readUtf16 = (at) => {
    if (at < 36 || pos + at + 2 > pos + infoSize) {
      return '';
    }
    const start = pos + at;
    let end = start;
    while (end + 2 <= pos + infoSize && buffer.readUInt16LE(end) !== 0) {
      end += 2;
    }
    return buffer.toString('utf16le', start, end);
  };
  let unicodeBase = '';
  let unicodeSuffix = '';
  if (infoHeader >= 36 && pos + 36 <= pos + infoSize) {
    unicodeBase = readUtf16(buffer.readUInt32LE(pos + 28));
    unicodeSuffix = readUtf16(buffer.readUInt32LE(pos + 32));
  }
  const ansiBaseOffset = buffer.readUInt32LE(pos + 16);
  const hasAnsiBase = ansiBaseOffset > 0 && pos + ansiBaseOffset < pos + infoSize;
  return { unicodeBase, unicodeSuffix, hasAnsiBase };
}

// Fixed PowerShell resolver: reads shortcut paths (one per stdin
// line), resolves each via WScript.Shell, prints one line per input
// as base64(shortcut) + space + base64(target). Script holds zero
// user input; paths travel via stdin, never command line. Base64
// framing avoids quoting and encoding pitfalls on any locale.
const RESOLVER_PS =
  "$ErrorActionPreference='SilentlyContinue';" +
  '$lines=@($input|ForEach-Object{$_.Trim()}|Where-Object{$_ -ne \'\'});' +
  "$s=New-Object -ComObject WScript.Shell;" +
  'foreach($p in $lines){$t=\'\';try{$t=[string]$s.CreateShortcut($p).TargetPath}catch{};' +
  '$a=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p));' +
  '$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t));' +
  'Write-Output ($a+\' \'+$b)}';

// Resolves ANSI-only shortcuts through Windows-native COM lookup.
// Single PowerShell spawn per call regardless of count. Returns Map
// of shortcut path to resolved target (possibly ''). Any failure
// (missing powershell, timeout, bad output) yields empty map, so
// callers mark entries unavailable instead of guessing paths.
// spawnFn and timeoutMs injectable for tests.
export async function resolveAnsiTargets(shortcutPaths, spawnFn = spawn, timeoutMs = 60000) {
  const paths = [...new Set((shortcutPaths || []).filter((p) => typeof p === 'string' && p !== ''))];
  const empty = new Map();
  if (paths.length === 0) {
    return empty;
  }
  const script = Buffer.from(RESOLVER_PS, 'utf16le').toString('base64');
  let child;
  try {
    child = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', script], {
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch {
    return empty;
  }
  const out = [];
  let done = false;
  const finish = (value) => {
    if (!done) {
      done = true;
      try {
        child.kill();
      } catch {
        // Already exited; map result stands.
      }
      return value;
    }
    return value;
  };
  try {
    child.stdout.on('data', (chunk) => {
      out.push(String(chunk));
      if (out.join('').length > 10 * 1024 * 1024) {
        try {
          child.kill();
        } catch {
          // Oversized output; parse what arrived.
        }
      }
    });
    child.stdin.write(paths.join('\n'), 'utf8');
    child.stdin.end();
  } catch {
    return finish(empty);
  }
  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), timeoutMs);
    child.on('error', () => {
      clearTimeout(timer);
      resolve('error');
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve('close');
    });
  });
  if (exit !== 'close') {
    return finish(empty);
  }
  const map = new Map();
  for (const raw of out.join('').split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.trim() === '') {
      continue;
    }
    const space = line.indexOf(' ');
    if (space < 0) {
      continue;
    }
    try {
      const shortcut = Buffer.from(line.slice(0, space), 'base64').toString('utf8');
      const target = Buffer.from(line.slice(space + 1).trim(), 'base64').toString('utf8');
      if (shortcut !== '') {
        map.set(shortcut, target);
      }
    } catch {
      // Corrupt line; skip without failing whole batch.
    }
  }
  finish(empty);
  return map;
}

// Builds catalog entry from known target. Stats file for availability.
// Returns entry with available=false when target missing.
async function makeEntry(shortcutPath, scope, root, target, unresolved) {
  const name = basename(shortcutPath, LNK_EXT);
  let available = false;
  if (target !== null) {
    try {
      await stat(target);
      available = true;
    } catch {
      available = false;
    }
  }
  return {
    id: stableId(shortcutPath),
    name,
    folder: dirname(relative(root, shortcutPath)),
    scope,
    shortcut: shortcutPath,
    target,
    available,
    unresolved,
  };
}

// Reads one shortcut file into catalog entry or null when skipped.
// Unicode targets resolve inline; ANSI-only paths queue for native
// lookup. Unresolvable files produce unavailable entries (target
// null, never launched) instead of vanishing. Never throws.
async function readShortcut(shortcutPath, scope, root, nativeTargets) {
  let bytes;
  try {
    bytes = await readFile(shortcutPath);
  } catch {
    return null;
  }
  const name = basename(shortcutPath, LNK_EXT);
  if (name.trim() === '') {
    return null;
  }
  const direct = parseLnkTarget(bytes);
  if (direct !== null) {
    if (!direct.toLowerCase().endsWith(EXE_EXT)) {
      return null;
    }
    return makeEntry(shortcutPath, scope, root, direct, false);
  }
  if (!needsNativeResolve(bytes)) {
    return null;
  }
  const resolved = nativeTargets.get(shortcutPath);
  if (typeof resolved !== 'string' || resolved === '' || !resolved.toLowerCase().endsWith(EXE_EXT)) {
    return makeEntry(shortcutPath, scope, root, null, true);
  }
  return makeEntry(shortcutPath, scope, root, resolved, false);
}

// Walks directory tree collecting .lnk paths. Unreadable folders
// are skipped, never fatal.
async function collectShortcuts(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectShortcuts(full, out);
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === LNK_EXT) {
      out.push(full);
    }
  }
}

// Discovers installed apps from Start Menu folders. Returns
// {apps, skipped} where skipped counts unreadable/unresolvable
// shortcuts. Unicode targets parse inline; ANSI-only files resolve
// through one native batch call. Unresolved entries stay listed as
// unavailable (never launched). Missing folders yield empty results.
// deps.resolveAnsi injects native lookup (default real) for tests.
export async function discoverCatalog(dirs = getStartMenuDirs(), deps = {}) {
  const apps = [];
  let skipped = 0;
  const seen = new Set();
  const resolveAnsi = typeof deps.resolveAnsi === 'function' ? deps.resolveAnsi : resolveAnsiTargets;
  const pending = [];
  for (const dir of dirs || []) {
    const scope = dir.includes('ProgramData') || dir.includes('programdata') ? 'all-users' : 'per-user';
    const found = [];
    await collectShortcuts(dir, found);
    for (const shortcut of found) {
      pending.push({ shortcut, scope, root: dir });
    }
  }
  const ansiQueue = [];
  const cached = new Map();
  for (const item of pending) {
    let bytes = null;
    try {
      bytes = await readFile(item.shortcut);
    } catch {
      bytes = null;
    }
    if (bytes === null) {
      skipped += 1;
      continue;
    }
    item.bytes = bytes;
    if (parseLnkTarget(bytes) === null && needsNativeResolve(bytes)) {
      ansiQueue.push(item.shortcut);
    }
  }
  if (ansiQueue.length > 0) {
    try {
      const resolved = await resolveAnsi(ansiQueue);
      for (const [key, value] of resolved) {
        cached.set(key, value);
      }
    } catch {
      // Native lookup failed; queued entries mark unavailable below.
    }
  }
  for (const item of pending) {
    if (!item.bytes) {
      continue;
    }
    const entry = await readShortcut(item.shortcut, item.scope, item.root, cached);
    if (entry === null) {
      skipped += 1;
      continue;
    }
    if (seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    apps.push(entry);
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return { apps, skipped };
}

// Finds catalog entry by stable ID. Returns entry or null.
// Only IDs issued by discovery resolve; names never match here.
export function resolveById(catalog, id) {
  if (!Array.isArray(catalog) || typeof id !== 'string' || id === '') {
    return null;
  }
  return catalog.find((entry) => entry.id === id) || null;
}

// Filters catalog by case-insensitive name substring. Empty query
// returns head of catalog. Caps at limit for autocomplete.
export function searchCatalog(catalog, query, limit = AUTOCOMPLETE_LIMIT) {
  if (!Array.isArray(catalog)) {
    return [];
  }
  const needle = String(query || '').toLowerCase();
  const matches =
    needle === '' ? catalog.slice() : catalog.filter((entry) => entry.name.toLowerCase().includes(needle));
  return matches.slice(0, limit);
}

// Maps entries to Discord autocomplete choices. Display combines
// name and parent folder so duplicates stay distinguishable.
// Discord caps names at 100 chars; value carries stable ID.
export function toAutocompleteChoices(entries) {
  return entries.map((entry) => {
    let label = entry.name;
    if (entry.folder !== null && entry.folder !== '' && entry.folder !== '.') {
      label += ` — ${entry.folder}`;
    }
    if (label.length > 100) {
      label = label.slice(0, 99) + '…';
    }
    return { name: label, value: entry.id };
  });
}

// Renders catalog matches as Discord-safe reply text. Caps lines
// and appends overflow count so huge catalogs stay readable.
export function formatAppsList(matches, total) {
  if (matches.length === 0) {
    return 'No applications found. Try another search.';
  }
  const lines = matches.slice(0, LIST_LIMIT).map((entry) => {
    const where = entry.folder !== null && entry.folder !== '' && entry.folder !== '.' ? ` (${entry.folder})` : '';
    const state = entry.available ? '' : ' [unavailable]';
    return `- ${entry.name}${where}${state}`;
  });
  if (total > matches.length) {
    lines.push(`…and ${total - matches.length} more. Refine search or pick from /pc open.`);
  }
  return `Applications (use /pc open to launch):\n${lines.join('\n')}`;
}

// Launches catalog entry without shell and detaches handle.
// Re-validates target and stats file on every call. Throws
// readable error for unknown IDs, unsafe targets, and missing files.
export async function launchApp(entry, spawnFn = spawn) {
  if (entry === null || typeof entry !== 'object') {
    throw new Error('Unknown application. Pick one from /pc open autocomplete.');
  }
  if (entry.target === null || entry.target === undefined || entry.unresolved === true) {
    throw new Error(`"${entry.name || 'app'}" path could not be resolved reliably. Not launching.`);
  }
  const target = String(entry.target || '').replace(/\//g, '\\');
  if (!/^[A-Za-z]:\\/.test(target) || target.includes('..') || !target.toLowerCase().endsWith(EXE_EXT)) {
    throw new Error(`Blocked unsafe target for "${entry.name || 'app'}".`);
  }
  try {
    await stat(target);
  } catch {
    throw new Error(`"${entry.name || 'app'}" target missing on this PC.`);
  }
  const child = spawnFn(target, [], {
    detached: true,
    stdio: 'ignore',
    shell: false,
    windowsVerbatimArguments: false,
  });
  child.unref();
  return entry.name;
}
