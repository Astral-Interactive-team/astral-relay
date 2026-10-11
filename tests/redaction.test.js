// Logger redaction tests. Ensures token-shaped values never survive
// info/warn/error detail paths, including nested objects and arrays.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../src/shared/logger.js';

describe('redact', () => {
  it('masks token-named keys', () => {
    const out = redact({ botToken: 'ABCDEF1234567890XYZ', other: 'hi' });
    assert.equal(out.botToken, '[REDACTED]');
    assert.equal(out.other, 'hi');
  });
  it('masks long secret-looking runs in strings', () => {
    const out = redact('login with ABCDEFGHIJKLMNOPQRSTUVWXYZ1234 done');
    assert.ok(!out.includes('ABCDEFGHIJKLMNOPQRSTUVWXYZ1234'));
    assert.ok(out.includes('[REDACTED]'));
  });
  it('leaves short ordinary text alone', () => {
    assert.equal(redact('hello world'), 'hello world');
  });
  it('redacts nested arrays and objects', () => {
    const out = redact({ items: [{ token: 'supersecretvalue1234567890' }] });
    assert.equal(out.items[0].token, '[REDACTED]');
  });
  it('masks bot-token shapes inside ordinary text', () => {
    const shaped = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.abcdef.GHIJKLMNOPQRSTUVWXYZ012345';
    assert.ok(!redact(`login failed for ${shaped} retry`).includes('GHIJKL'));
  });
});
