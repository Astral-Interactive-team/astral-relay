// Builder helper and backoff tests. Uses temp dirs, never runs pkg.
// Covers stale-output archival, backoff caps, and login retry bounds.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archiveStaleOutput } from '../src/builder/build-agent.js';
import { backoffDelay, isFatalAuthError, loginWithBackoff } from '../src/agent/connection.js';

describe('archiveStaleOutput', () => {
  it('returns null when no output exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-'));
    assert.equal(await archiveStaleOutput(join(dir, 'missing.exe')), null);
  });
  it('renames existing output aside', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'relay-'));
    const exe = join(dir, 'app.exe');
    await writeFile(exe, 'x');
    const backup = await archiveStaleOutput(exe);
    assert.ok(backup !== null && backup !== exe);
    await assert.rejects(() => stat(exe));
    await stat(backup);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially then caps at 60s', () => {
    assert.equal(backoffDelay(0), 1000);
    assert.equal(backoffDelay(1), 2000);
    assert.equal(backoffDelay(10), 60000);
  });
});

describe('loginWithBackoff', () => {
  it('returns first success without retry', async () => {
    let calls = 0;
    const out = await loginWithBackoff(async () => {
      calls += 1;
      return 'ok';
    }, 3);
    assert.equal(out, 'ok');
    assert.equal(calls, 1);
  });
  it('throws last error after attempts run out', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        loginWithBackoff(async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        }, 2),
      /fail-2/,
    );
    assert.equal(calls, 2);
  });
  it('rethows fatal auth errors at once without retry', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        loginWithBackoff(async () => {
          calls += 1;
          throw new Error('An invalid token was provided.');
        }, 6),
      /invalid token/,
    );
    assert.equal(calls, 1);
  });
});

describe('isFatalAuthError', () => {
  it('matches invalid tokens, ignores network errors', () => {
    assert.equal(isFatalAuthError(new Error('An invalid token was provided.')), true);
    assert.equal(isFatalAuthError({ code: 'TokenInvalid' }), true);
    assert.equal(isFatalAuthError(new Error('getaddrinfo ENOTFOUND')), false);
    assert.equal(isFatalAuthError(null), false);
  });
});
