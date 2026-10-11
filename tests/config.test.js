// Configuration schema tests. No files involved: defaults come
// from code, validation is pure. Covers new guild-free schema,
// legacy-key rejection, token rejection, and permission notes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_VERSION,
  VALID_PERMISSIONS,
  defaultRuntimeConfig,
  permissionNote,
  requireValidConfig,
  validateConfig,
} from '../src/shared/config.js';

function good() {
  return {
    requiredPermission: 'ManageGuild',
    enabledCommands: ['status', 'open', 'apps', 'lock'],
    agentVersion: '0.1.0',
  };
}

describe('defaultRuntimeConfig', () => {
  it('passes validation with zero user input', () => {
    assert.deepEqual(validateConfig(defaultRuntimeConfig()), []);
    assert.equal(defaultRuntimeConfig().agentVersion, AGENT_VERSION);
  });
});

describe('validateConfig', () => {
  it('accepts good config', () => {
    assert.deepEqual(validateConfig(good()), []);
  });
  it('rejects unknown permission and empty version', () => {
    assert.ok(validateConfig({ ...good(), requiredPermission: 'Nope' }).length > 0);
    assert.ok(validateConfig({ ...good(), agentVersion: '' }).length > 0);
  });
  it('rejects unknown command, accepts apps', () => {
    assert.ok(validateConfig({ ...good(), enabledCommands: ['shell'] }).length > 0);
    assert.deepEqual(validateConfig({ ...good(), enabledCommands: ['apps'] }), []);
  });
  it('rejects removed guild and application IDs', () => {
    assert.ok(validateConfig({ ...good(), guildId: '111111111111111111' }).some((p) => p.includes('guildId')));
    assert.ok(
      validateConfig({ ...good(), applicationId: '111111111111111111' }).some((p) => p.includes('applicationId')),
    );
  });
  it('rejects removed allowlists', () => {
    assert.ok(validateConfig({ ...good(), authorizedUserIds: [] }).length > 0);
    assert.ok(validateConfig({ ...good(), allowedApps: [] }).length > 0);
  });
  it('rejects embedded token fields', () => {
    assert.ok(validateConfig({ ...good(), botToken: 'x' }).length > 0);
    assert.ok(validateConfig({ ...good(), token: 'x' }).length > 0);
  });
});

describe('requireValidConfig', () => {
  it('returns config when valid, throws ConfigError otherwise', () => {
    assert.deepEqual(requireValidConfig(good()), good());
    assert.throws(() => requireValidConfig({}), /requiredPermission/);
  });
});

describe('permissionNote', () => {
  it('documents every supported permission', () => {
    for (const name of VALID_PERMISSIONS) {
      assert.ok(typeof permissionNote(name) === 'string' && permissionNote(name).length > 0, name);
    }
  });
  it('returns null for unknown names', () => {
    assert.equal(permissionNote('Nope'), null);
  });
});
