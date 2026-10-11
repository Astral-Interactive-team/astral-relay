// Command payload and global registration tests. No network:
// buildCommandPayload shapes JSON, registerGlobalCommands runs
// against an injected REST mock. Covers permission default, apps
// subcommand, global route (never guild-scoped), and failures.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, Routes } from 'discord.js';
import { authSourceOf, buildCommandPayload, registerGlobalCommands } from '../src/agent/discord/client.js';

function config() {
  return {
    requiredPermission: 'ManageGuild',
    enabledCommands: ['status', 'open', 'apps', 'lock'],
    agentVersion: '0.1.0',
  };
}

describe('buildCommandPayload', () => {
  it('sets default member permissions from config', () => {
    const [root] = buildCommandPayload(config());
    assert.equal(root.name, 'pc');
    assert.equal(root.default_member_permissions, String(PermissionsBitField.Flags.ManageGuild));
    const subs = root.options.map((o) => o.name);
    assert.ok(subs.includes('apps'));
    assert.ok(subs.includes('open'));
  });
  it('omits disabled subcommands', () => {
    const [root] = buildCommandPayload({ ...config(), enabledCommands: ['status'] });
    assert.deepEqual(root.options.map((o) => o.name), ['status']);
  });
  it('throws ConfigError for unknown permission', () => {
    assert.throws(() => buildCommandPayload({ ...config(), requiredPermission: 'Nope' }), /requiredPermission/);
  });
});

describe('registerGlobalCommands', () => {
  it('puts payload to the global route with application id', async () => {
    let seen = null;
    const fakeRest = () => ({
      put: async (route, { body }) => {
        seen = { route, body };
        return body;
      },
    });
    await registerGlobalCommands(config(), 'token', '123456789012345678', fakeRest);
    assert.equal(seen.route, Routes.applicationCommands('123456789012345678'));
    assert.ok(!seen.route.includes('guilds'));
    assert.equal(seen.body[0].name, 'pc');
  });
});

describe('authSourceOf', () => {
  it('marks guild context without any configured guild id', () => {
    const source = authSourceOf({ inGuild: () => true, memberPermissions: { bitfield: 8n }, guildId: 'anything' });
    assert.equal(source.inGuild, true);
    assert.ok(!('guildId' in source));
  });
  it('marks DMs as non-guild', () => {
    const source = authSourceOf({ inGuild: () => false, memberPermissions: null });
    assert.equal(source.inGuild, false);
  });
});

describe('clearGuildCommands', () => {
  it('empties guild command lists to remove duplicates', async () => {
    const puts = [];
    const fakeRest = () => ({
      put: async (route, { body }) => {
        puts.push({ route, body });
        return body;
      },
    });
    const client = { guilds: { cache: new Map([['g1', { id: 'g1' }], ['g2', { id: 'g2' }]]) } };
    const { clearGuildCommands } = await import('../src/agent/discord/client.js');
    assert.equal(await clearGuildCommands(client, '123456789012345678', fakeRest, 'token'), 2);
    assert.equal(puts.length, 2);
    assert.ok(puts.every((put) => put.route.includes('guilds') && put.body.length === 0));
  });
  it('handles missing guild cache without failing', async () => {
    const { clearGuildCommands } = await import('../src/agent/discord/client.js');
    assert.equal(await clearGuildCommands({}, '123456789012345678', () => ({ put: async () => {} })), 0);
  });
});
