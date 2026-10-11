// Centralized Discord interaction authorization gate.
// Every incoming command and autocomplete request passes here before
// any Windows operation runs. Works in every guild where the bot is
// installed: requires guild context plus member permission bits for
// the configured flag. Administrator bypasses the minimum, ordinary
// members are denied, DMs (no guild) are denied. No single-guild
// allowlist exists. Pure function over plain data, so tests cover
// it without Discord.

import { PermissionsBitField } from 'discord.js';
import { AuthError } from '../../shared/errors.js';

// Resolves permission flag name to bit. Returns null when unknown,
// so callers fail closed instead of granting access.
export function resolvePermissionBit(name) {
  const bit = PermissionsBitField.Flags[name];
  if (typeof bit !== 'bigint' && typeof bit !== 'number') {
    return null;
  }
  return BigInt(bit);
}

// Returns true when source is a guild interaction whose permission
// bits hold requiredPermission (or Administrator). Source shape:
// {inGuild, permissions} with permissions as bigint, number, or
// numeric string (interaction.memberPermissions.bitfield).
export function isAuthorized(source, config) {
  if (source === null || typeof source !== 'object') {
    return false;
  }
  if (config === null || typeof config !== 'object') {
    return false;
  }
  if (source.inGuild !== true) {
    return false;
  }
  if (source.permissions === null || source.permissions === undefined) {
    return false;
  }
  let bits;
  try {
    bits = BigInt(source.permissions);
  } catch {
    return false;
  }
  const required = resolvePermissionBit(config.requiredPermission);
  if (required === null) {
    return false;
  }
  if ((bits & required) === required) {
    return true;
  }
  const admin = BigInt(PermissionsBitField.Flags.Administrator);
  return (bits & admin) === admin;
}

// Throws AuthError unless authorized. Call at top of each command
// and autocomplete handler, before touching Windows APIs.
export function requireAuthorized(source, config) {
  if (!isAuthorized(source, config)) {
    throw new AuthError('Unauthorized: guild context plus management permission required.');
  }
}
