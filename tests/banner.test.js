// Banner loading, ordering, and color-gating tests. No terminal
// needed: color paths take explicit flags, support checks use fake
// env and stream objects.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BANNER_PATH, centerText, loadBannerText, renderBanner, startupScreen } from '../src/cli/banner.js';
import { bold, cyan, green, mixRgb, red, supportsColor, yellow } from '../src/cli/theme.js';

const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
const hasAnsi = (text) => /\x1b\[[0-9;]*m/.test(text);

describe('loadBannerText', () => {
  it('loads art matching banner.txt bytes', async () => {
    const raw = await readFile(BANNER_PATH, 'utf8');
    assert.equal(await loadBannerText(), raw);
    assert.ok(raw.includes('___'));
    assert.ok(raw.includes('discord.gg/bSvcQG8K4f'));
    assert.ok(!raw.includes('v0idtool'));
  });
  it('keeps art left-aligned block shape', async () => {
    const raw = await loadBannerText();
    const lines = raw.replace(/\n$/, '').split('\n');
    assert.ok(lines.length >= 5);
    assert.ok(lines.slice(0, 6).every((line) => line.length > 0));
    assert.ok(raw.includes('t.me/astral_int'));
  });
  it('returns empty string for missing file', async () => {
    assert.equal(await loadBannerText('C:\\nonexistent\\banner.txt'), '');
  });
});

describe('renderBanner', () => {
  it('preserves every character when colors on', async () => {
    const raw = await loadBannerText();
    assert.equal(stripAnsi(renderBanner(raw, true)), raw);
    assert.ok(hasAnsi(renderBanner(raw, true)));
  });
  it('returns text untouched when colors off', async () => {
    const raw = await loadBannerText();
    assert.equal(renderBanner(raw, false), raw);
    assert.ok(!hasAnsi(renderBanner(raw, false)));
  });
  it('grades first line cyan and last line purple', () => {
    const out = renderBanner('aa\nbb', true);
    assert.ok(out.startsWith('\x1b[38;2;0;255;255m'));
    assert.ok(out.includes('\x1b[38;2;168;85;247m'));
  });
});

describe('supportsColor', () => {
  it('denies when NO_COLOR set, even with TTY', () => {
    assert.equal(supportsColor({ NO_COLOR: '' }, { isTTY: true }), false);
  });
  it('denies when stdout is not a TTY', () => {
    assert.equal(supportsColor({}, { isTTY: false }), false);
    assert.equal(supportsColor({}, undefined), false);
  });
  it('allows TTY without NO_COLOR', () => {
    assert.equal(supportsColor({}, { isTTY: true }), true);
  });
});

describe('startupScreen', () => {
  it('orders banner, version, then menu exactly once', async () => {
    const raw = await loadBannerText();
    const screen = startupScreen(renderBanner(raw, false), false);
    const artLine = raw.split('\n')[2];
    assert.equal(screen.indexOf(artLine), screen.lastIndexOf(artLine));
    assert.ok(screen.indexOf(artLine) < screen.indexOf('Astral Relay v'));
    assert.ok(screen.indexOf('discord.gg/bSvcQG8K4f') < screen.indexOf('Development Console'));
    assert.ok(screen.includes('[01] Generate Agent EXE'));
    assert.ok(screen.includes('[00] Exit'));
  });
  it('omits art block gracefully when banner missing', () => {
    const screen = startupScreen('', false);
    assert.ok(screen.includes('Development Console'));
    assert.ok(!screen.startsWith('\n'));
  });
});

describe('centerText', () => {
  it('pads short lines to center', () => {
    assert.equal(centerText('ab', 10), '    ab');
  });
  it('leaves long lines and null width untouched', () => {
    assert.equal(centerText('abcdefghij', 8), 'abcdefghij');
    assert.equal(centerText('ab', null), 'ab');
    assert.equal(centerText('', 80), '');
  });
  it('preserves line breaks and centers short lines only', async () => {
    const raw = await loadBannerText();
    const centered = centerText(raw, 80);
    assert.equal(centered.endsWith('\n'), raw.endsWith('\n'));
    const body = centered.endsWith('\n') ? centered.slice(0, -1) : centered;
    const long = body.split('\n').filter((line) => line.length > 80);
    assert.ok(long.length > 0);
    assert.ok(centered.length > raw.length);
  });
  it('combines centering with color losslessly', async () => {
    const raw = await loadBannerText();
    const out = renderBanner(raw, true, 80);
    assert.equal(stripAnsi(out), centerText(raw, 80));
    assert.ok(hasAnsi(out));
  });
});

describe('theme helpers', () => {  it('reset every colored section', () => {
    for (const fn of [bold, cyan, green, red, yellow]) {
      assert.ok(fn('x', true).endsWith('\x1b[0m'));
      assert.equal(fn('x', false), 'x');
    }
  });
  it('interpolates gradient endpoints', () => {
    assert.deepEqual(mixRgb([0, 255, 255], [168, 85, 247], 0), [0, 255, 255]);
    assert.deepEqual(mixRgb([0, 255, 255], [168, 85, 247], 1), [168, 85, 247]);
  });
});

describe('optionLine', () => {
  it('paints number cyan and quit label yellow', async () => {
    const { optionLine } = await import('../src/cli/banner.js');
    const normal = optionLine('├──', '01', 'Generate Agent EXE', true);
    assert.ok(normal.includes('\x1b[36m[01]'));
    assert.ok(normal.includes('\x1b[32mGenerate Agent EXE'));
    const quit = optionLine('└──', '00', 'Exit ([Q] quit)', true, true);
    assert.ok(quit.includes('\x1b[33mExit ([Q] quit)'));
    assert.ok(normal.endsWith('\x1b[0m'));
  });
  it('stays plain with alignment intact when disabled', async () => {
    const { optionLine } = await import('../src/cli/banner.js');
    assert.equal(optionLine('├──', '01', 'Generate Agent EXE', false), ' ├── [01] Generate Agent EXE');
  });
});
