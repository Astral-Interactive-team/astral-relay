// Windows session lock for /pc lock.
// Uses rundll32 user32 LockWorkStation, the supported mechanism.
// Fixed argument vector, no shell, fails safe with clear message.

import { spawnSync } from 'node:child_process';

// Locks current session. Throws readable error when it cannot run.
export function lockSession(run = spawnSync) {
  const result = run('rundll32.exe', ['user32.dll,LockWorkStation'], {
    shell: false,
    stdio: 'ignore',
  });
  if (result.error) {
    throw new Error(`Lock failed: ${result.error.message}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Lock failed with exit code ${result.status}.`);
  }
}
