// Two-page menu router tests.
// Covers HOME/RELAY choice parsing, navigation, social-link selection,
// invalid input, exit aliases, empty/null input, and backward-compat
// parseDevChoice. Interactive loop and real browser opening stay manual.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseHomeChoice, parseRelayChoice, parseDevChoice } from '../src/cli/menu.js';
import { homePageBlock, relayPageBlock } from '../src/cli/banner.js';

// ── HOME-page parsing ─────────────────────────────────────────────
describe('parseHomeChoice', () => {
  it('maps 01/1 → github', () => {
    assert.equal(parseHomeChoice('01'), 'github');
    assert.equal(parseHomeChoice('1'),  'github');
  });
  it('maps 02/2 → telegram', () => {
    assert.equal(parseHomeChoice('02'), 'telegram');
    assert.equal(parseHomeChoice('2'),  'telegram');
  });
  it('maps 03/3 → discord', () => {
    assert.equal(parseHomeChoice('03'), 'discord');
    assert.equal(parseHomeChoice('3'),  'discord');
  });
  it('maps N/next → next (navigate to RELAY)', () => {
    assert.equal(parseHomeChoice('n'),    'next');
    assert.equal(parseHomeChoice('N'),    'next');
    assert.equal(parseHomeChoice('next'), 'next');
  });
  it('maps Q/quit/exit/empty → exit', () => {
    assert.equal(parseHomeChoice('q'),    'exit');
    assert.equal(parseHomeChoice('Q'),    'exit');
    assert.equal(parseHomeChoice('quit'), 'exit');
    assert.equal(parseHomeChoice('exit'), 'exit');
    assert.equal(parseHomeChoice(''),     'exit');
  });
  it('trims whitespace before parsing', () => {
    assert.equal(parseHomeChoice('  01  '), 'github');
    assert.equal(parseHomeChoice(' N '),    'next');
    assert.equal(parseHomeChoice(' Q '),    'exit');
  });
  it('rejects invalid input without action', () => {
    for (const raw of ['4', 'asdf', '11', '1a', '0', '00', 'b', 'back']) {
      assert.equal(parseHomeChoice(raw), null, JSON.stringify(raw));
    }
  });
  it('handles null and undefined without throwing', () => {
    assert.equal(parseHomeChoice(null),      'exit');
    assert.equal(parseHomeChoice(undefined), 'exit');
  });
});

// ── RELAY-page parsing ────────────────────────────────────────────
describe('parseRelayChoice', () => {
  it('maps 01/1 → generate', () => {
    assert.equal(parseRelayChoice('01'), 'generate');
    assert.equal(parseRelayChoice('1'),  'generate');
  });
  it('maps 02/2 → start', () => {
    assert.equal(parseRelayChoice('02'), 'start');
    assert.equal(parseRelayChoice('2'),  'start');
  });
  it('maps B/back → back (navigate to HOME)', () => {
    assert.equal(parseRelayChoice('b'),    'back');
    assert.equal(parseRelayChoice('B'),    'back');
    assert.equal(parseRelayChoice('back'), 'back');
  });
  it('maps Q/quit/exit → exit', () => {
    assert.equal(parseRelayChoice('q'),    'exit');
    assert.equal(parseRelayChoice('Q'),    'exit');
    assert.equal(parseRelayChoice('quit'), 'exit');
    assert.equal(parseRelayChoice('exit'), 'exit');
  });
  it('trims whitespace before parsing', () => {
    assert.equal(parseRelayChoice('  02  '), 'start');
    assert.equal(parseRelayChoice(' B '),    'back');
    assert.equal(parseRelayChoice(' Q '),    'exit');
  });
  it('rejects invalid input without action', () => {
    for (const raw of ['3', 'asdf', '11', '1a', 'n', 'next', '']) {
      assert.equal(parseRelayChoice(raw), null, JSON.stringify(raw));
    }
  });
  it('handles null and undefined without throwing', () => {
    assert.equal(parseRelayChoice(null),      null);
    assert.equal(parseRelayChoice(undefined), null);
  });
});

// ── Backward-compat parseDevChoice ───────────────────────────────
describe('parseDevChoice (compat)', () => {
  it('delegates to parseRelayChoice', () => {
    assert.equal(parseDevChoice('01'), 'generate');
    assert.equal(parseDevChoice('1'),  'generate');
    assert.equal(parseDevChoice('02'), 'start');
    assert.equal(parseDevChoice('2'),  'start');
    assert.equal(parseDevChoice('b'),  'back');
    assert.equal(parseDevChoice('q'),  'exit');
  });
  it('rejects unknown input', () => {
    assert.equal(parseDevChoice('99'), null);
    assert.equal(parseDevChoice('xx'), null);
  });
});

// ── Navigation symmetry ───────────────────────────────────────────
describe('navigation: HOME → RELAY → HOME', () => {
  it('N on HOME navigates to relay page', () => {
    assert.equal(parseHomeChoice('N'), 'next');
  });
  it('B on RELAY returns to home page', () => {
    assert.equal(parseRelayChoice('B'), 'back');
  });
  it('B on HOME is not a valid action (no accidental back)', () => {
    assert.equal(parseHomeChoice('b'), null);
    assert.equal(parseHomeChoice('B'), null);
  });
  it('N on RELAY is not a valid action (no accidental nav)', () => {
    assert.equal(parseRelayChoice('n'), null);
    assert.equal(parseRelayChoice('N'), null);
  });
});

// ── No accidental builds or agent starts during navigation ────────
describe('safety: navigation never triggers operations', () => {
  it('HOME N choice is "next", not generate/start', () => {
    assert.notEqual(parseHomeChoice('N'), 'generate');
    assert.notEqual(parseHomeChoice('N'), 'start');
  });
  it('RELAY B choice is "back", not generate/start', () => {
    assert.notEqual(parseRelayChoice('B'), 'generate');
    assert.notEqual(parseRelayChoice('B'), 'start');
  });
  it('invalid HOME choices do not trigger generate or start', () => {
    for (const raw of ['x', '99', 'asdf']) {
      assert.equal(parseHomeChoice(raw), null);
    }
  });
  it('invalid RELAY choices do not trigger generate or start', () => {
    for (const raw of ['x', '99', 'asdf']) {
      assert.equal(parseRelayChoice(raw), null);
    }
  });
});

// ── Page block rendering ──────────────────────────────────────────
describe('homePageBlock', () => {
  it('contains page indicator 1/2', () => {
    assert.ok(homePageBlock(false).includes('1/2'));
  });
  it('contains all three social link labels', () => {
    const block = homePageBlock(false);
    assert.ok(block.includes('[01]'));
    assert.ok(block.includes('[02]'));
    assert.ok(block.includes('[03]'));
    assert.ok(block.includes('GitHub'));
    assert.ok(block.includes('Telegram'));
    assert.ok(block.includes('Discord'));
  });
  it('contains navigation hint [N]', () => {
    assert.ok(homePageBlock(false).includes('[N]'));
  });
  it('contains quit hint [Q]', () => {
    assert.ok(homePageBlock(false).includes('[Q]'));
  });
  it('contains actual HTTPS URLs', () => {
    const block = homePageBlock(false);
    assert.ok(block.includes('https://github.com/Astral-Interactive-team/astral-relay'));
    assert.ok(block.includes('https://t.me/astral_int'));
    assert.ok(block.includes('https://discord.gg/bSvcQG8K4f'));
  });
  it('produces no ANSI when color disabled', () => {
    assert.ok(!/\x1b\[/.test(homePageBlock(false)));
  });
  it('produces ANSI codes when color enabled', () => {
    assert.ok(/\x1b\[/.test(homePageBlock(true)));
  });
});

describe('relayPageBlock', () => {
  it('contains page indicator 2/2', () => {
    assert.ok(relayPageBlock(false).includes('2/2'));
  });
  it('contains both relay option labels', () => {
    const block = relayPageBlock(false);
    assert.ok(block.includes('[01]'));
    assert.ok(block.includes('[02]'));
    assert.ok(block.includes('Generate Agent EXE'));
    assert.ok(block.includes('Start Agent'));
  });
  it('contains back hint [B]', () => {
    assert.ok(relayPageBlock(false).includes('[B]'));
  });
  it('contains quit hint [Q]', () => {
    assert.ok(relayPageBlock(false).includes('[Q]'));
  });
  it('produces no ANSI when color disabled', () => {
    assert.ok(!/\x1b\[/.test(relayPageBlock(false)));
  });
  it('produces ANSI codes when color enabled', () => {
    assert.ok(/\x1b\[/.test(relayPageBlock(true)));
  });
});

// ── Social link allowlist ─────────────────────────────────────────
describe('SOCIAL_LINKS allowlist', () => {
  it('every URL is HTTPS', async () => {
    const { SOCIAL_LINKS } = await import('../src/cli/social-links.js');
    for (const [key, url] of Object.entries(SOCIAL_LINKS)) {
      assert.ok(url.startsWith('https://'), `${key} must be HTTPS`);
    }
  });
  it('contains github, telegram, discord keys', async () => {
    const { SOCIAL_LINKS } = await import('../src/cli/social-links.js');
    assert.ok('github'   in SOCIAL_LINKS);
    assert.ok('telegram' in SOCIAL_LINKS);
    assert.ok('discord'  in SOCIAL_LINKS);
  });
});

// ── openUrl allowlist enforcement ─────────────────────────────────
describe('openUrl', () => {
  it('refuses URLs not in allowlist', async () => {
    const { openUrl } = await import('../src/cli/menu.js');
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));
    try {
      const result = await openUrl('https://evil.example.com', false);
      assert.equal(result, false);
      assert.ok(logs.some((l) => l.includes('Blocked')));
    } finally {
      console.log = origLog;
    }
  });
});

// ── Kali prompt ───────────────────────────────────────────────────
describe('kaliPromptLines', () => {
  it('returns line1 and line2 keys', async () => {
    const { kaliPromptLines } = await import('../src/cli/menu.js');
    const p = kaliPromptLines(false);
    assert.ok('line1' in p);
    assert.ok('line2' in p);
  });
  it('line1 contains astral@relay and ~/Astral_int', async () => {
    const { kaliPromptLines } = await import('../src/cli/menu.js');
    const { line1 } = kaliPromptLines(false);
    assert.ok(line1.includes('astral@relay'));
    assert.ok(line1.includes('~/Astral_int'));
  });
  it('line2 contains >> and trailing space, no hint text', async () => {
    const { kaliPromptLines } = await import('../src/cli/menu.js');
    const { line2 } = kaliPromptLines(false);
    assert.ok(line2.includes('>>'));
    assert.ok(line2.endsWith(' '));
    assert.ok(!line2.includes('Select an option'));
    assert.ok(!line2.includes('[01'));
  });
  it('produces no ANSI when color disabled', async () => {
    const { kaliPromptLines } = await import('../src/cli/menu.js');
    const { line1, line2 } = kaliPromptLines(false);
    assert.ok(!/\x1b\[/.test(line1));
    assert.ok(!/\x1b\[/.test(line2));
  });
  it('produces ANSI codes when color enabled', async () => {
    const { kaliPromptLines } = await import('../src/cli/menu.js');
    const { line1, line2 } = kaliPromptLines(true);
    assert.ok(/\x1b\[/.test(line1));
    assert.ok(/\x1b\[/.test(line2));
  });
  it('same prompt for both HOME and RELAY pages', async () => {
    // kaliPromptLines has no page param — same output regardless of page.
    const { kaliPromptLines } = await import('../src/cli/menu.js');
    const a = kaliPromptLines(false);
    const b = kaliPromptLines(false);
    assert.equal(a.line1, b.line1);
    assert.equal(a.line2, b.line2);
  });
});
