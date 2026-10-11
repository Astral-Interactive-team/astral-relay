// Non-secret Agent configuration schema and validation.
// No configuration files exist: the builder embeds DEFAULT values
// as the EXE payload, and the agent reads payload or embedded copy
// only. The bot token is never part of this schema and lives only
// in process memory for the run.
//
// Authorization is permission-based in every guild where the bot
// is installed: any member holding requiredPermission (default
// ManageGuild) may control the Agent. No guild IDs, no per-user
// IDs, no application allowlist stored here; launch targets come
// from live Start Menu discovery instead.

import { ConfigError } from './errors.js';

export const AGENT_VERSION = '0.1.0';
export const VALID_COMMANDS = ['status', 'open', 'apps', 'lock'];
export const DEFAULT_PERMISSION = 'ManageGuild';

// Implication of each supported requiredPermission. Weaker settings
// widen who can run PC commands; only members holding the chosen
// flag (or Administrator) pass the agent gate.
export const PERMISSION_NOTES = {
  Administrator: 'Full server ownership: holders already control roles, bots, and settings. Widest access.',
  ManageGuild: 'Server managers: trusted operators who change settings and manage bots. Recommended default.',
  ManageRoles: 'WARNING: role managers can grant themselves Administrator, so this equals Administrator in practice.',
  ManageChannels: 'Channel managers: structural control over channels, no server-wide settings or bot control.',
  ManageMessages: 'Moderators: message cleanup only, no settings or role control. Weak; widens operator pool.',
  ManageThreads: 'Thread moderators only. Weak; widens operator pool.',
  ManageEvents: 'Event managers only. Weak; widens operator pool.',
  ManageNicknames: 'Nickname managers only. Weak; widens operator pool.',
  ModerateMembers: 'Timeout managers only. Weak; widens operator pool.',
  ManageWebhooks: 'Webhook managers: can pipe channel content outward. Weak; widens operator pool.',
  ViewAuditLog: 'Auditors: read-only log access plus PC control. Weakest; widens operator pool.',
  KickMembers: 'Kick power only. Weak; widens operator pool.',
  BanMembers: 'Ban power only. Weak; widens operator pool.',
};

// Returns implication note for permission name, or null when unknown.
export function permissionNote(name) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_NOTES, name) ? PERMISSION_NOTES[name] : null;
}

// Server-management permission flags accepted as requiredPermission.
// Curated subset of Discord permission names; runtime resolves the
// bit via PermissionsBitField and denies when unknown.
export const VALID_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'ManageMessages',
  'ManageThreads',
  'ManageEvents',
  'ManageNicknames',
  'ModerateMembers',
  'ManageWebhooks',
  'ViewAuditLog',
  'KickMembers',
  'BanMembers',
];

// Default non-secret runtime config embedded by the builder. No
// user-supplied file feeds this; builder writes it verbatim.
export function defaultRuntimeConfig() {
  return {
    requiredPermission: DEFAULT_PERMISSION,
    enabledCommands: ['status', 'open', 'apps', 'lock'],
    agentVersion: AGENT_VERSION,
  };
}

// Validates raw object, returns list of human-readable problems.
// Empty list means valid. Never throws, so callers print all issues.
export function validateConfig(raw) {
  const problems = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['Configuration must be a JSON object.'];
  }
  if (typeof raw.requiredPermission !== 'string' || !VALID_PERMISSIONS.includes(raw.requiredPermission)) {
    problems.push(`requiredPermission must be one of: ${VALID_PERMISSIONS.join(', ')}.`);
  }
  if (!Array.isArray(raw.enabledCommands) || raw.enabledCommands.length === 0) {
    problems.push('enabledCommands must list at least one of: status, open, apps, lock.');
  } else {
    for (const name of raw.enabledCommands) {
      if (!VALID_COMMANDS.includes(name)) {
        problems.push(`enabledCommands holds unknown command: ${String(name)}.`);
        break;
      }
    }
  }
  if (typeof raw.agentVersion !== 'string' || raw.agentVersion === '') {
    problems.push('agentVersion must be a non-empty string.');
  }
  for (const legacy of ['guildId', 'applicationId', 'authorizedUserIds', 'allowedApps']) {
    if (legacy in raw) {
      problems.push(`${legacy} was removed. Rebuild the EXE; no configuration file is used.`);
    }
  }
  if ('botToken' in raw || 'token' in raw) {
    problems.push('Configuration must never hold a token. Enter it at startup; it lives in memory only.');
  }
  return problems;
}

// Throws ConfigError naming first problem. Used by builder and agent.
export function requireValidConfig(raw) {
  const problems = validateConfig(raw);
  if (problems.length > 0) {
    throw new ConfigError(problems[0]);
  }
  return raw;
}
