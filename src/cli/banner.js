// Startup banner loader and renderer for interactive CLI menu.
// Reads banner.txt once per invocation, resolved against module
// location (never process.cwd()), paints a cyan-to-purple gradient
// per line when colors are on, and preserves every art character,
// spacing, and line break. Missing file yields empty art so the
// menu still starts. banner.txt itself is never written.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bold, cyan, gray, green, mixRgb, purple, truecolor, white, yellow } from './theme.js';
import { AGENT_VERSION } from '../shared/config.js';
import { SOCIAL_LINKS } from './social-links.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const BANNER_PATH = join(HERE, '..', '..', 'banner.txt');

const GRADIENT_FROM = [0, 255, 255];
const GRADIENT_TO = [168, 85, 247];

// Loads raw banner text. Returns '' when missing or unreadable so
// startup degrades to menu-only instead of crashing.
export async function loadBannerText(path = BANNER_PATH) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}

// Centers each line in given width by left padding. Characters
// untouched, only spaces prepended. Lines at/over width unchanged.
// Null width returns text as-is, keeping redirected output pristine.
export function centerText(text, width) {
  if (typeof width !== 'number' || !(width > 0) || text === '') {
    return text;
  }
  const trailing = text.endsWith('\n') ? '\n' : '';
  const body = trailing === '\n' ? text.slice(0, -1) : text;
  const centered = body.split('\n').map((line) => {
    const pad = Math.floor((width - line.length) / 2);
    return pad > 0 ? ' '.repeat(pad) + line : line;
  });
  return centered.join('\n') + trailing;
}

// Paints each art line along cyan-to-purple gradient. Centers first
// when width given, then colors. Characters, spacing, and line
// breaks pass through untouched; only spaces prepended and ANSI
// codes wrapped. Returns text unchanged when disabled.
export function renderBanner(text, enabled, width = null) {
  const laid = centerText(text, width);
  if (!enabled || laid === '') {
    return laid;
  }
  const trailing = laid.endsWith('\n') ? '\n' : '';
  const body = trailing === '\n' ? laid.slice(0, -1) : laid;
  const lines = body.split('\n');
  const painted = lines.map((line, index) => {
    const factor = lines.length <= 1 ? 0 : index / (lines.length - 1);
    return truecolor(line, mixRgb(GRADIENT_FROM, GRADIENT_TO, factor), true);
  });
  return painted.join('\n') + trailing;
}

// Paints one menu option row: cyan number tag, plain label, or
// yellow label for the quit row. Tree glyphs stay plain so box
// alignment never shifts under ANSI codes.
export function optionLine(tree, num, label, enabled, quit = false) {
  const tag = bold(cyan(`[${num}]`, enabled), enabled);
  const name = quit ? yellow(label, enabled) : green(label, enabled);
  return ` ${tree} ${tag} ${name}`;
}

// Builds HOME page (page 1/2): social links menu.
// Art printed separately so runMenu renders it once without repeating.
export function homePageBlock(enabled) {
  const bar = cyan(' │', enabled);
  return [
    purple(' ┌── HOME · 1/2', enabled),
    bar,
    purple(' ├── ASTRAL INTERACTIVE', enabled),
    optionLine(cyan('│', enabled) + '   ├──', '01', `${white('GitHub', enabled)}    ${SOCIAL_LINKS.github}`, enabled),
    optionLine(cyan('│', enabled) + '   ├──', '02', `${white('Telegram', enabled)}  ${SOCIAL_LINKS.telegram}`, enabled),
    optionLine(cyan('│', enabled) + '   └──', '03', `${white('Discord', enabled)}   ${SOCIAL_LINKS.discord}`, enabled),
    bar,
    yellow(` ├── [N] next ──> RELAY`, enabled),
    bar,
    yellow(` └── [Q] quit`, enabled),
    '',
  ].join('\n');
}

// Builds RELAY page (page 2/2): main actions menu.
export function relayPageBlock(enabled) {
  const bar = cyan(' │', enabled);
  return [
    purple(' ┌── RELAY · 2/2', enabled),
    bar,
    purple(' ├── ASTRAL RELAY', enabled),
    optionLine(cyan('│', enabled) + '   ├──', '01', 'Generate Agent EXE', enabled),
    optionLine(cyan('│', enabled) + '   └──', '02', 'Start Agent', enabled),
    bar,
    yellow(` ├── [B] back ──> HOME`, enabled),
    bar,
    yellow(` └── [Q] quit`, enabled),
    '',
  ].join('\n');
}

// Builds full startup screen for backward-compat tests: banner,
// version block, and HOME menu in void tree style.
export function startupScreen(art, enabled) {
  const parts = [];
  if (art !== '') {
    parts.push(art);
    parts.push('');
  }
  parts.push(gray(` Astral Relay v${AGENT_VERSION} | Development Console`, enabled));
  parts.push(gray(' by Astral Interactive', enabled));
  parts.push('');
  parts.push(' ┌── HOME');
  parts.push(' │');
  parts.push(optionLine('├──', '01', 'Generate Agent EXE', enabled));
  parts.push(optionLine('├──', '02', 'Start Agent', enabled));
  parts.push(optionLine('└──', '00', 'Exit ([Q] quit)', enabled, true));
  parts.push('');
  return parts.join('\n');
}
