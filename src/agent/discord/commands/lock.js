// /pc lock command definition and handler.
// Locks Windows session via windows/lock.js. Reports safe error
// text when the operation cannot complete.

import { SlashCommandSubcommandBuilder } from 'discord.js';
import { lockSession } from '../../windows/lock.js';

// Builds subcommand descriptor for registration payload.
export function buildLockCommand() {
  return new SlashCommandSubcommandBuilder().setName('lock').setDescription('Lock the Windows session.');
}

// Handles interaction. Authorization already checked by caller.
export async function handleLock(interaction) {
  try {
    lockSession();
    await interaction.reply({ content: 'Session locked.', ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: `Could not lock: ${err.message}`, ephemeral: true });
  }
}
