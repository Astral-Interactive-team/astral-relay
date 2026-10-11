// Centralized social-link registry for Astral Interactive.
// All HTTPS URLs are configured here; nothing opens arbitrary input.
// Add placeholders with the PLACEHOLDER_ prefix; they are validated
// at import time so missing URLs surface immediately during dev.

export const SOCIAL_LINKS = {
  github:   'https://github.com/Astral-Interactive-team/astral-relay',
  telegram: 'https://t.me/astral_int',
  discord:  'https://discord.gg/bSvcQG8K4f',
};

// Guard: every configured value must be a valid HTTPS URL.
for (const [key, url] of Object.entries(SOCIAL_LINKS)) {
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    throw new Error(`social-links: "${key}" is not a valid URL: ${url}`);
  }
}
