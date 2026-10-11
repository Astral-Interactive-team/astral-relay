// /pc open command definition, autocomplete, and handler.
// Option value carries the catalog stable ID, never a path or name.
// Handler resolves the ID against a fresh local catalog, so only
// discovered entries launch and free-typed text is rejected.

import { SlashCommandSubcommandBuilder } from 'discord.js';
import { launchApp, resolveById, searchCatalog, toAutocompleteChoices } from '../../windows/apps.js';

// Builds subcommand descriptor with autocomplete option. No static
// choices, so catalogs of any size work through filtering.
export function buildOpenCommand() {
  return new SlashCommandSubcommandBuilder()
    .setName('open')
    .setDescription('Launch an installed application.')
    .addStringOption((opt) =>
      opt.setName('app').setDescription('Start typing to search apps.').setRequired(true).setAutocomplete(true),
    );
}

// Answers autocomplete with filtered catalog choices. Authorization
// already checked by caller; failures reply empty, never details.
export async function handleOpenAutocomplete(interaction, catalog) {
  const focused = String(interaction.options.getFocused() || '');
  const matches = searchCatalog(catalog, focused);
  await interaction.respond(toAutocompleteChoices(matches));
}

// Handles interaction. Authorization already checked by caller.
export async function handleOpen(interaction, catalog) {
  const picked = interaction.options.getString('app', true);
  const entry = resolveById(catalog, picked);
  if (entry === null) {
    await interaction.reply({ content: 'Unknown selection. Pick one from autocomplete.', ephemeral: true });
    return;
  }
  try {
    const started = await launchApp(entry);
    await interaction.reply({ content: `Launched "${started}".`, ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Could not launch: ${err.message}`, ephemeral: true });
  }
}
