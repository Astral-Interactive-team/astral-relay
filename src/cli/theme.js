// Astral Interactive terminal theme for CLI output.
// Single place for ANSI styling. Colors stay off when NO_COLOR is
// set or stdout is not a TTY, so redirected output and tests stay
// plain. Every helper resets styling to stop color leakage.

const RESET = '\x1b[0m';

// Returns true when colored output is wanted. NO_COLOR disables in
// all cases; otherwise a TTY stream is required.
export function supportsColor(env = process.env, stream = process.stdout) {
  if (env !== null && typeof env === 'object' && 'NO_COLOR' in env) {
    return false;
  }
  return stream !== null && stream !== undefined && stream.isTTY === true;
}

// Wraps text in ANSI code when enabled, else returns text untouched.
function paint(code, text, enabled) {
  if (!enabled) {
    return text;
  }
  return `\x1b[${code}m${text}${RESET}`;
}

// Colors prompt/success text green or plain when disabled.
export function green(text, enabled) {
  return paint(32, text, enabled);
}

// Colors banner accents and headings cyan or plain when disabled.
export function cyan(text, enabled) {
  return paint(36, text, enabled);
}

// Colors headings purple or plain when disabled.
export function purple(text, enabled) {
  return paint(35, text, enabled);
}

// Colors dark purple accents (special characters) or plain when disabled.
export function darkPurple(text, enabled) {
  return paint('38;5;54', text, enabled);
}

// Colors text white or plain when disabled.
export function white(text, enabled) {
  return paint(37, text, enabled);
}

// Colors version and subtitle muted gray or plain when disabled.
export function gray(text, enabled) {
  return paint(90, text, enabled);
}

// Colors errors and failed builds red or plain when disabled.
export function red(text, enabled) {
  return paint(31, text, enabled);
}

// Colors warnings yellow or plain when disabled.
export function yellow(text, enabled) {
  return paint(33, text, enabled);
}

// Bolds menu title or returns text untouched when disabled.
export function bold(text, enabled) {
  return paint(1, text, enabled);
}

// Interpolates RGB pair by factor 0..1. Used for banner gradient.
export function mixRgb(from, to, factor) {
  return from.map((channel, index) => Math.round(channel + (to[index] - channel) * factor));
}

// Paints one line in truecolor RGB or plain when disabled.
export function truecolor(line, rgb, enabled) {
  if (!enabled) {
    return line;
  }
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${line}${RESET}`;
}
