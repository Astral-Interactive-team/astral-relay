// /pc status command definition and handler.
// Replies with host facts from windows/info.js. Runs only after
// the authorization gate in client.js passes.

import { SlashCommandSubcommandBuilder } from 'discord.js';
import { getStatus, formatStatus } from '../../windows/info.js';

// Builds subcommand descriptor for registration payload.
export function buildStatusCommand() {
  return new SlashCommandSubcommandBuilder().setName('status').setDescription('Show agent connection and host info.');
}

// Handles interaction. No Windows side effects besides reading facts.
export async function handleStatus(interaction, config) {
  const snapshot = getStatus(config.agentVersion, true);
  await interaction.reply({ content: formatStatus(snapshot), ephemeral: true });
}
