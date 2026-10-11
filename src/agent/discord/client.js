// Discord client wiring: login, global command sync, routing.
// Executed by agent entry after token is available. Registers
// application commands globally through REST after login (bot id
// read from the live session, never configured), then routes /pc
// subcommands and open-option autocomplete in every guild where
// the bot is installed. Global commands can take up to an hour to
// appear everywhere. Every routing path calls requireAuthorized
// before any Windows operation; Discord-side defaults are
// visibility only, never the enforcement.

import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { requireAuthorized, resolvePermissionBit } from '../security/authorize.js';
import { buildStatusCommand, handleStatus } from './commands/status.js';
import { buildOpenCommand, handleOpen, handleOpenAutocomplete } from './commands/open.js';
import { buildAppsCommand, handleApps } from './commands/apps.js';
import { buildLockCommand, handleLock } from './commands/lock.js';
import { discoverCatalog } from '../windows/apps.js';
import { ConfigError } from '../../shared/errors.js';
import { info, error } from '../../shared/logger.js';

// Builds /pc command payload from enabled flags. Root carries default
// member permissions so ordinary members never see the command, while
// the agent still enforces the same bit on every request.
export function buildCommandPayload(config) {
  const bit = resolvePermissionBit(config.requiredPermission);
  if (bit === null) {
    throw new ConfigError(`requiredPermission unknown to discord.js: ${String(config.requiredPermission)}.`);
  }
  const root = new SlashCommandBuilder()
    .setName('pc')
    .setDescription('Control this PC.')
    .setDefaultMemberPermissions(bit);
  const enabled = new Set(config.enabledCommands || []);
  if (enabled.has('status')) {
    root.addSubcommand(buildStatusCommand());
  }
  if (enabled.has('open')) {
    root.addSubcommand(buildOpenCommand());
  }
  if (enabled.has('apps')) {
    root.addSubcommand(buildAppsCommand());
  }
  if (enabled.has('lock')) {
    root.addSubcommand(buildLockCommand());
  }
  return [root.toJSON()];
}

// Registers global application commands via Discord REST. Runs
// each startup to sync. restFactory injects a mock in tests.
export async function registerGlobalCommands(config, token, applicationId, restFactory = defaultRest) {
  const rest = restFactory(token);
  await rest.put(Routes.applicationCommands(applicationId), {
    body: buildCommandPayload(config),
  });
}

// Builds an authenticated REST client. Kept separate for injection.
function defaultRest(token) {
  return new REST({ version: '10' }).setToken(token);
}

// Extracts auth source from interaction. Guild context plus member
// permissions; DMs carry no guild and are denied later.
export function authSourceOf(interaction) {
  return {
    inGuild: interaction.inGuild(),
    permissions: interaction.memberPermissions ? interaction.memberPermissions.bitfield : null,
  };
}

// Discovers fresh catalog, tolerating errors as empty results so a
// broken shortcut folder degrades to "no apps" instead of crash.
async function freshCatalog(discover) {
  try {
    const result = await discover();
    return Array.isArray(result.apps) ? result.apps : [];
  } catch {
    return [];
  }
}

// Creates logged-in client and attaches interaction router.
// discover injects catalog source (default: live Start Menu scan).
// Returns client. Caller owns destroy() on shutdown.
export async function startClient(config, token, discover = discoverCatalog) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on('interactionCreate', async (interaction) => {
    if (interaction.isAutocomplete()) {
      if (interaction.commandName !== 'pc') {
        return;
      }
      try {
        requireAuthorized(authSourceOf(interaction), config);
      } catch {
        try {
          await interaction.respond([]);
        } catch {
          // Autocomplete expired; nothing safe left to do.
        }
        return;
      }
      try {
        await handleOpenAutocomplete(interaction, await freshCatalog(discover));
      } catch {
        try {
          await interaction.respond([]);
        } catch {
          // Autocomplete expired after handler failure.
        }
      }
      return;
    }
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'pc') {
      return;
    }
    try {
      requireAuthorized(authSourceOf(interaction), config);
    } catch {
      error('Rejected unauthorized interaction.');
      try {
        await interaction.reply({ content: 'Not authorized.', ephemeral: true });
      } catch {
        // Reply path already dead; nothing safe left to do.
      }
      return;
    }
    const sub = interaction.options.getSubcommand(false);
    try {
      if (sub === 'status' && config.enabledCommands.includes('status')) {
        await handleStatus(interaction, config);
      } else if (sub === 'open' && config.enabledCommands.includes('open')) {
        await handleOpen(interaction, await freshCatalog(discover));
      } else if (sub === 'apps' && config.enabledCommands.includes('apps')) {
        await handleApps(interaction, await freshCatalog(discover));
      } else if (sub === 'lock' && config.enabledCommands.includes('lock')) {
        await handleLock(interaction);
      } else {
        await interaction.reply({ content: 'Unknown or disabled subcommand.', ephemeral: true });
      }
    } catch (err) {
      error('Command handler failed.', { sub: String(sub) });
      try {
        const payload = { content: 'Command failed.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
        // Interaction expired; error already logged above.
      }
    }
  });
  info('Logging in to Discord.');
  await client.login(token);
  const applicationId = client.application.id || (await client.application.fetch()).id;
  info('Syncing global commands.');
  await registerGlobalCommands(config, token, applicationId);
  await clearGuildCommands(client, applicationId, defaultRest, token);
  info('Discord client ready.');
  return client;
}

// Deletes leftover guild-scoped command copies from every visible
// guild. Older builds registered /pc per guild, which Discord shows
// alongside the global command as a duplicate. Bulk overwrite with
// an empty list per guild; failures (missing access) skip quietly.
export async function clearGuildCommands(client, applicationId, restFactory = defaultRest, token = null) {
  const rest = restFactory(token);
  const guilds = client.guilds && client.guilds.cache ? [...client.guilds.cache.values()] : [];
  for (const guild of guilds) {
    try {
      await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), { body: [] });
    } catch {
      // No access or gone guild; global commands still work.
    }
  }
  return guilds.length;
}
