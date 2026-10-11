// astral-relay CLI entry. No arguments opens interactive menu.
// Subcommand build regenerates the EXE non-interactively (same
// pipeline as menu option 1). Installed via package.json bin field.

import { Command } from 'commander';
import { AGENT_VERSION } from '../src/shared/config.js';
import { runMenu } from '../src/cli/menu.js';
import { buildCommand } from '../src/cli/commands/build.js';

const program = new Command();
program.name('astral-relay').description('Build and run AstralRelay Agent EXE.').version(AGENT_VERSION);
program
  .command('build')
  .description('Generate dist/AstralRelay-Agent.exe.')
  .action(async () => {
    const ok = await buildCommand();
    process.exit(ok ? 0 : 1);
  });

// No subcommand: open interactive menu. Handles cancellation cleanly.
if (process.argv.length <= 2) {
  runMenu().catch((err) => {
    console.error(`Menu failed: ${err.message}`);
    process.exit(1);
  });
} else {
  program.parseAsync(process.argv).catch((err) => {
    console.error(`Command failed: ${err.message}`);
    process.exit(1);
  });
}
