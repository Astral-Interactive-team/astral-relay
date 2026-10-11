// Session lock tests. run is an injected fake so nothing locks.
// Covers spawn failure, nonzero exit, and success path.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lockSession } from '../src/agent/windows/lock.js';

describe('lockSession', () => {
  it('throws readable error when spawn fails', () => {
    const failing = () => ({ error: new Error('boom') });
    assert.throws(() => lockSession(failing), /Lock failed/);
  });
  it('throws on nonzero exit', () => {
    assert.throws(() => lockSession(() => ({ status: 1 })), /exit code 1/);
  });
  it('passes on zero exit', () => {
    lockSession(() => ({ status: 0 }));
  });
});
