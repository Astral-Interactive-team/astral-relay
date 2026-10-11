// Permission-based authorization gate tests, guild-free. Bit math
// only, no Discord connection. Covers manager allow in any guild,
// ordinary-member deny, DM deny, admin bypass, unknown flag.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField } from 'discord.js';
import { isAuthorized, requireAuthorized, resolvePermissionBit } from '../src/agent/security/authorize.js';

const Flags = PermissionsBitField.Flags;
const config = { requiredPermission: 'ManageGuild' };
const manager = { inGuild: true, permissions: Flags.ManageGuild };
const ordinary = { inGuild: true, permissions: Flags.SendMessages };

describe('resolvePermissionBit', () => {
  it('resolves known flag to bit', () => {
    assert.equal(resolvePermissionBit('ManageGuild'), BigInt(Flags.ManageGuild));
  });
  it('returns null for unknown flag', () => {
    assert.equal(resolvePermissionBit('NoSuchPerm'), null);
  });
});

describe('isAuthorized', () => {
  it('accepts manager in any guild, no ID match needed', () => {
    assert.equal(isAuthorized(manager, config), true);
    assert.equal(isAuthorized({ inGuild: true, permissions: Flags.ManageGuild | Flags.SendMessages }, config), true);
  });
  it('denies ordinary member', () => {
    assert.equal(isAuthorized(ordinary, config), false);
  });
  it('denies DM without guild context', () => {
    assert.equal(isAuthorized({ inGuild: false, permissions: Flags.ManageGuild }, config), false);
    assert.equal(isAuthorized({ inGuild: true, permissions: null }, config), false);
  });
  it('accepts Administrator without required flag', () => {
    assert.equal(isAuthorized({ inGuild: true, permissions: Flags.Administrator }, config), true);
  });
  it('accepts numeric string bitfield from gateway', () => {
    assert.equal(isAuthorized({ inGuild: true, permissions: String(Flags.ManageGuild) }, config), true);
  });
  it('denies when configured flag unknown', () => {
    assert.equal(isAuthorized(manager, { requiredPermission: 'NoSuchPerm' }), false);
  });
  it('denies malformed source', () => {
    assert.equal(isAuthorized(null, config), false);
    assert.equal(isAuthorized({}, config), false);
  });
});

describe('requireAuthorized', () => {
  it('throws AuthError for ordinary member', () => {
    assert.throws(() => requireAuthorized(ordinary, config), /Unauthorized/);
  });
});
