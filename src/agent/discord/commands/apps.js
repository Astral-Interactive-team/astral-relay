// /pc apps command definition and handler.
// Searches the live Start Menu catalog by optional query text and
// replies with an ephemeral list. Read-only; nothing launches here.

import { SlashCommandSubcommandBuilder } from 'discord.js';
import { formatAppsList, searchCatalog } from '../../windows/apps.js';

// Builds subcommand descriptor with optional search query.
export function buildAppsCommand() {
  return new SlashCommandSubcommandBuilder()
    .setName('apps')
    .setDescription('List installed applications.')
    .addStringOption((opt) => opt.setName('query').setDescription('Filter by name.').setRequired(false));
}

// Handles interaction. Authorization already checked by caller.
export async function handleApps(interaction, catalog) {
  const query = interaction.options.getString('query', false) || '';
  const matches = searchCatalog(catalog, query);
  await interaction.reply({ content: formatAppsList(matches, catalog.length), ephemeral: true });
}
