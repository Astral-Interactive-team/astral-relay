// build command: prompts token once, then produces Agent EXE through
// cached template plus appended production payload. Reports success
// only when output exists and passes smoke test. Failures keep the
// previous good output and print an actionable, secret-free cause.
// promptToken injects input in tests; default is the secure prompt.

import { buildAgent, promptBuildToken } from '../../builder/build-agent.js';
import { error } from '../../shared/logger.js';
import { green, red, supportsColor } from '../theme.js';

// Runs full generation. Returns true on verified success.
export async function buildCommand({ promptToken = promptBuildToken } = {}) {
  const enabled = supportsColor();
  try {
    const result = await buildAgent({ promptToken });
    console.log(green(`Build passed: ${result.exePath}`, enabled));
    console.log(green(`Smoke test: ${result.versionLine}`, enabled));
    return true;
  } catch (err) {
    error('Build failed.', { message: err.message });
    console.log(red(`Build failed: ${err.message}`, enabled));
    return false;
  }
}
