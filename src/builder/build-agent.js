// EXE build pipeline for dist/AstralRelay-Agent.exe.
// Flow: secure token prompt, reuse or rebuild cached token-free SEA
// template (build-cache dir, fingerprint-gated), copy template to
// temp path, append production payload (token plus non-secret
// settings), verify roundtrip, flip GUI subsystem for silent launch,
// smoke test, atomically rename into dist. Token changes skip
// packaging entirely. Template never holds a token. Build log
// redacts secrets.

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { BuildError } from '../shared/errors.js';
import { defaultRuntimeConfig } from '../shared/config.js';
import { appendProductionPayload, isPlausibleBotToken, readPayload } from '../agent/payload.js';
import { computeFingerprint, loadFingerprint, saveFingerprint } from './fingerprint.js';
import { setGuiSubsystem } from './subsystem.js';
import { promptForToken } from '../agent/secure-input.js';
import { info, error, redact } from '../shared/logger.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const ROOT_PKG = join(ROOT, 'package.json');
const ROOT_PKG_BAK = join(ROOT, 'package.json.buildbak');
const STAGED_CONFIG = join(ROOT, 'src', 'agent', 'embedded-config.json');
const DIST_DIR = join(ROOT, 'dist');
const OUTPUT_EXE = join(DIST_DIR, 'AstralRelay-Agent.exe');
const CACHE_DIR = join(ROOT, 'build-cache');
const TEMPLATE_EXE = join(CACHE_DIR, 'AstralRelay-Agent-base.exe');
const FINGERPRINT_PATH = join(CACHE_DIR, 'template.json');
const MIN_EXE_BYTES = 10 * 1024 * 1024;

// Runs pkg against repo root, so walker root covers src, shared,
// and node_modules in one scope. Builds only during staged bin.
// outputExe selects template or direct target path.
function runPkg(logLines, outputExe) {
  return new Promise((resolvePromise, rejectPromise) => {
    const require = createRequire(import.meta.url);
    const bin = require.resolve('@yao-pkg/pkg/lib-es5/bin.js');
    const child = spawn(process.execPath, [bin, '.', '--sea', '-t', 'node24-win-x64', '-o', outputExe], {
      cwd: ROOT,
      shell: false,
    });
    child.stdout.on('data', (chunk) => {
      logLines.push(redact(String(chunk)));
    });
    child.stderr.on('data', (chunk) => {
      logLines.push(redact(String(chunk)));
    });
    child.on('error', (err) => {
      rejectPromise(new BuildError(`Packager failed to start: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new BuildError(`Packager exited with code ${code}. See dist build log.`));
      }
    });
  });
}

// Smoke-tests built EXE via --version flag. Proves binary starts
// without Node runtime and holds correct embedded version.
function smokeTest(exePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(exePath, ['--version'], { shell: false });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += String(chunk);
    });
    child.on('error', (err) => {
      rejectPromise(new BuildError(`Built EXE failed to start: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0 && out.includes('AstralRelay-Agent')) {
        resolvePromise(out.trim());
      } else {
        rejectPromise(new BuildError('Built EXE --version check failed.'));
      }
    });
  });
}

// Packages fresh template to templateExe with placeholder config.
// Caller stages bin and placeholder first. Verifies size and smoke,
// then records the pre-staging fingerprint passed in.
async function packageTemplate(log, logLines, fingerprint) {
  await runPkg(logLines, TEMPLATE_EXE);
  const meta = await stat(TEMPLATE_EXE);
  if (meta.size < MIN_EXE_BYTES) {
    throw new BuildError(`Template suspiciously small (${meta.size} bytes). Build incomplete.`);
  }
  log(`Template verified: ${meta.size} bytes.`);
  const versionLine = await smokeTest(TEMPLATE_EXE);
  log(`Template smoke test passed: ${versionLine}`);
  await saveFingerprint(FINGERPRINT_PATH, fingerprint);
}

// Ensures cached template is fresh, rebuilding through full SEA
// pipeline when missing or stale. Returns 'reused' or 'rebuilt'.
// Template embeds placeholder config only; user settings travel
// via appended payload, never inside the cached binary.
async function ensureTemplate(log, logLines, stageBin) {
  const stored = await loadFingerprint(FINGERPRINT_PATH);
  const live = await computeFingerprint(ROOT);
  let templateOk = false;
  try {
    templateOk = (await stat(TEMPLATE_EXE)).size >= MIN_EXE_BYTES;
  } catch {
    templateOk = false;
  }
  if (stored !== null && stored.fingerprint === live && templateOk) {
    log('Template cache hit: skipping packaging pipeline.');
    return 'reused';
  }
  if (stored === null) {
    log('No template cache: cold packaging run.');
  } else if (stored.fingerprint !== live) {
    log(`Template stale: repackaging. (stored ${String(stored.fingerprint).slice(0, 12)}, live ${live.slice(0, 12)})`);
  } else {
    log('Template file damaged: repackaging.');
  }
  await stageBin(JSON.stringify(defaultRuntimeConfig(), null, 2));
  await packageTemplate(log, logLines, live);
  return 'rebuilt';
}

// Copies template to temp path, appends production payload, verifies
// roundtrip and smoke test, flips GUI subsystem, then atomically
// renames into place. Temp file removed on any failure, previous
// valid output preserved; template never mutated, never tokenized.
async function injectAndVerify(log, token, staged) {
  const tempExe = join(DIST_DIR, `.agent-tmp-${process.pid}.exe`);
  try {
    await copyFile(TEMPLATE_EXE, tempExe);
  } catch (err) {
    throw new BuildError(`Template copy failed: ${err.message}`);
  }
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const retryFileOp = async (label, fn) => {
    let last;
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      try {
        await fn();
        return;
      } catch (err) {
        last = err;
        log(`${label} locked (attempt ${attempt}/30), retrying.`);
        await sleep(2000);
      }
    }
    throw new BuildError(`${label} failed after retries: ${last.message}`);
  };
  try {
    await appendProductionPayload(tempExe, token, staged);
    const found = await readPayload(tempExe);
    if (found === null || found.token !== token || JSON.stringify(found.config) !== JSON.stringify(staged)) {
      throw new BuildError('Payload roundtrip mismatch.');
    }
    await setGuiSubsystem(tempExe);
    const versionLine = await smokeTest(tempExe);
    await retryFileOp('Removing previous output', () => rm(OUTPUT_EXE, { force: true }));
    await retryFileOp('Publishing new output', () => rename(tempExe, OUTPUT_EXE));
    return versionLine;
  } catch (err) {
    try {
      await rm(tempExe, { force: true });
    } catch {
      // Temp cleanup best-effort; original error matters.
    }
    if (err !== null && typeof err === 'object' && /EPERM|EBUSY|ENOTEMPTY/i.test(String(err.message || ''))) {
      throw new BuildError(
        `${err.message} If the Agent is running, stop it first: a running EXE locks its own file.`,
      );
    }
    throw err;
  }
}

// Secure build-time token prompt with Kali styling. Masked input,
// empty rejected by prompt itself. Token returned in memory only.
export async function promptBuildToken() {
  return promptForToken();
}

// Resolves build token from argument or secure prompt, validated
// before packaging starts. Empty or malformed input aborts fast so
// no expensive work runs. Token returned in memory only.
export async function resolveBuildToken({ token = null, promptToken = promptBuildToken } = {}) {
  const live = token === null ? await promptToken() : token;
  if (!isPlausibleBotToken(live)) {
    throw new BuildError('Token rejected: expected bot token shape (three dot-separated parts).');
  }
  return live.trim();
}

// Generates EXE with embedded token plus default non-secret config.
// No input files: settings are builder constants, token arrives via
// argument or secure prompt (dependency-injected in tests). Token
// validated before packaging starts; failures keep previous output.
// Returns {exePath, versionLine}.
export async function buildAgent({ token = null, promptToken = promptBuildToken } = {}) {
  const staged = defaultRuntimeConfig();
  await mkdir(DIST_DIR, { recursive: true });
  await mkdir(CACHE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const logPath = join(DIST_DIR, `build-${stamp}.log`);
  const logLines = [];
  const log = (text) => {
    logLines.push(redact(String(text)));
  };
  let wroteLog = false;
  const flushLog = async () => {
    if (!wroteLog) {
      wroteLog = true;
      await writeFile(logPath, logLines.join('\n') + '\n', 'utf8');
    }
  };
  let rootPkgText = null;
  // Recovers interrupted staging BEFORE fingerprinting, so residue
  // from a killed build can never poison freshness checks.
  const recoverStaging = async () => {
    try {
      const leftover = await readFile(ROOT_PKG_BAK, 'utf8');
      await writeFile(ROOT_PKG, leftover, 'utf8');
      await rm(ROOT_PKG_BAK, { force: true });
      log('Recovered package.json from interrupted build.');
    } catch {
      // No leftover backup: normal path.
    }
  };
  const stageBin = async (embeddedJson) => {
    await recoverStaging();
    rootPkgText = await readFile(ROOT_PKG, 'utf8');
    const rootPkg = JSON.parse(rootPkgText);
    await writeFile(ROOT_PKG_BAK, rootPkgText, 'utf8');
    rootPkg.bin = 'src/agent/index.js';
    await writeFile(ROOT_PKG, JSON.stringify(rootPkg, null, 2) + '\n', 'utf8');
    await writeFile(STAGED_CONFIG, embeddedJson, 'utf8');
  };
  try {
    const liveToken = await resolveBuildToken({ token, promptToken });
    log(`Generating AstralRelay-Agent v${staged.agentVersion} for node24-win-x64 SEA.`);
    await recoverStaging();
    const cacheState = await ensureTemplate(log, logLines, stageBin);
    log(`Template ${cacheState}; injecting production payload.`);
    const versionLine = await injectAndVerify(log, liveToken, staged);
    log(`Payload injected and verified: ${versionLine}`);
    info(`Build done: ${OUTPUT_EXE}`);
    return { exePath: OUTPUT_EXE, versionLine };
  } catch (err) {
    error('Build failed.', { message: err.message });
    throw err instanceof BuildError ? err : new BuildError(err.message);
  } finally {
    try {
      await rm(STAGED_CONFIG, { force: true });
    } catch {
      // Staging cleanup best-effort; never masks build result.
    }
    if (rootPkgText !== null) {
      try {
        await writeFile(ROOT_PKG, rootPkgText, 'utf8');
        await rm(ROOT_PKG_BAK, { force: true });
      } catch {
        // Backup file keeps original for next-build recovery.
      }
    }
    try {
      await flushLog();
    } catch {
      // Log flush failure must not hide build outcome.
    }
  }
}

// Renames stale output aside before rebuild. Exported for tests.
export async function archiveStaleOutput(exePath = OUTPUT_EXE) {
  try {
    await stat(exePath);
  } catch {
    return null;
  }
  const backup = `${exePath}.stale-${Date.now()}`;
  await rename(exePath, backup);
  return backup;
}
