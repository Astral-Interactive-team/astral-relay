// Secure input tests. Fake streams drive raw-mode masking;
// fallback path covered with non-TTY pipes. Token value itself
// never asserted in output, only star counts and erase codes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { INTERRUPTED, voidHeader, voidPrompt, promptForToken, readSecureLine } from '../src/agent/secure-input.js';

function ttyInput() {
  const emitter = new EventEmitter();
  emitter.isTTY = true;
  emitter.setRawMode = () => {};
  emitter.pause = () => {};
  emitter.resume = () => {};
  return emitter;
}

function sink(isTTY = false) {
  const chunks = [];
  return {
    chunks,
    isTTY,
    write: (text) => {
      chunks.push(String(text));
      return true;
    },
    on: () => {},
    text: () => chunks.join(''),
  };
}

describe('readSecureLine masking', () => {
  it('returns typed text while printing stars only', async () => {
    const input = ttyInput();
    const output = sink();
    const pending = readSecureLine({ input, output });
    input.emit('data', 'a');
    input.emit('data', 'b');
    input.emit('data', '\r');
    assert.equal(await pending, 'ab');
    assert.equal(output.text(), '**\n');
  });
  it('rewrites echoed plaintext with stars on TTY', async () => {
    const input = ttyInput();
    const output = sink(true);
    const pending = readSecureLine({ input, output, prefix: voidPrompt('Discord Bot Token') });
    output.write('tok123');
    for (const char of 'tok123') {
      input.emit('data', char);
    }
    input.emit('data', '\r');
    assert.equal(await pending, 'tok123');
    const text = output.text();
    assert.ok(text.lastIndexOf('tok123') < text.lastIndexOf('\x1b[2K'));
    assert.ok(text.slice(text.lastIndexOf('\x1b[2K')).includes('******'));
  });
  it('handles backspace by shrinking buffer', async () => {
    const input = ttyInput();
    const output = sink();
    const pending = readSecureLine({ input, output });
    input.emit('data', 'a');
    input.emit('data', 'b');
    input.emit('data', '\x7f');
    input.emit('data', 'c');
    input.emit('data', '\n');
    assert.equal(await pending, 'ac');
  });
  it('rejects INTERRUPTED on Ctrl+C', async () => {
    const input = ttyInput();
    const output = sink();
    const pending = readSecureLine({ input, output });
    input.emit('data', '\x03');
    await assert.rejects(pending, new RegExp(INTERRUPTED));
  });
  it('falls back without raw mode and never crashes', async () => {
    const { PassThrough } = await import('node:stream');
    const input = new PassThrough();
    input.isTTY = false;
    const output = sink();
    output.isTTY = false;
    const pending = readSecureLine({ input, output });
    input.write('plain-token\n');
    assert.equal(await pending, 'plain-token');
    assert.ok(output.text().includes('echo'));
  });
  it('conceals fallback echo on TTY without raw mode', async () => {
    const { PassThrough } = await import('node:stream');
    const input = new PassThrough();
    input.isTTY = true;
    const output = sink(true);
    const pending = readSecureLine({ input, output, prefix: voidPrompt('Discord Bot Token') });
    input.write('plain-token\n');
    assert.equal(await pending, 'plain-token');
    const text = output.text();
    assert.ok(text.lastIndexOf('plain-token') < text.lastIndexOf('\x1b[2K'));
    assert.ok(text.slice(text.lastIndexOf('\x1b[2K')).includes('*'.repeat('plain-token'.length)));
  });
});

describe('promptForToken', () => {
  it('shows void header and prompt, rejects empty input', async () => {
    const input = ttyInput();
    const output = sink();
    const pending = promptForToken({ input, output });
    input.emit('data', '\r');
    await assert.rejects(pending, /Empty token/);
    assert.ok(output.text().includes(voidHeader()));
    assert.ok(output.text().includes(voidPrompt('Discord Bot Token')));
  });
  it('returns trimmed token without printing it', async () => {
    const input = ttyInput();
    const output = sink(true);
    const pending = promptForToken({ input, output });
    for (const char of 'tok123') {
      input.emit('data', char);
    }
    input.emit('data', '\r');
    assert.equal(await pending, 'tok123');
    assert.ok(!output.text().includes('tok123'));
  });
});
