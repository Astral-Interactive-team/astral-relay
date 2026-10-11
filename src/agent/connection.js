// Bounded login retry with exponential backoff.
// discord.js reconnects by itself after login, but initial login
// (bad network, outage) retries here. Fatal errors such as an
// invalid token rethrow immediately: retrying rejected credentials
// is pointless and risks lockout.

import { info, warn } from '../shared/logger.js';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 60000;
const MAX_ATTEMPTS = 6;

// Matches discord.js invalid-token rejections. Never includes token
// text; matching runs on error shape only.
export function isFatalAuthError(err) {
  if (err === null || typeof err !== 'object') {
    return false;
  }
  if (err.code === 'TokenInvalid' || err.code === 401) {
    return true;
  }
  return /invalid token/i.test(String(err.message || ''));
}

// Runs loginFn until success or attempts run out. Delay grows as
// base * 2^index with jitter, capped at one minute. Fatal auth
// errors rethrow at once. Rethrows last error when exhausted so
// entry can exit nonzero.
export async function loginWithBackoff(loginFn, attempts = MAX_ATTEMPTS, isFatal = isFatalAuthError) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await loginFn();
    } catch (err) {
      lastError = err;
      if (isFatal(err)) {
        warn('Authentication rejected. Not retrying.');
        throw err;
      }
      if (i === attempts - 1) {
        break;
      }
      const delay = Math.min(BASE_DELAY_MS * 2 ** i, MAX_DELAY_MS);
      const jitter = Math.floor(Math.random() * 500);
      warn(`Login attempt ${i + 1} failed. Retrying soon.`);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  info('Login retries exhausted.');
  throw lastError;
}

// Computes backoff delay for attempt index. Exported for tests.
export function backoffDelay(index) {
  return Math.min(BASE_DELAY_MS * 2 ** index, MAX_DELAY_MS);
}
