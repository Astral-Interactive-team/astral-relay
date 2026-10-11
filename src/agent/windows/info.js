// Read-only host facts for /pc status replies.
// Returns connection state, platform, architecture, agent version,
// and uptime. Exposes no usernames, SIDs, or local paths.

import os from 'node:os';

// Builds status snapshot. Pure, safe to call on every command.
export function getStatus(agentVersion, connected) {
  return {
    connected,
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    agentVersion,
    uptimeSeconds: Math.floor(process.uptime()),
  };
}

// Renders snapshot as single Discord-safe reply line block.
export function formatStatus(status) {
  const state = status.connected ? 'connected' : 'starting';
  return (
    `Status: ${state}\n` +
    `Platform: ${status.platform} ${status.arch} (${status.release})\n` +
    `Agent: v${status.agentVersion}\n` +
    `Uptime: ${status.uptimeSeconds}s`
  );
}
