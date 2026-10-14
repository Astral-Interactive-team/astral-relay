# !pc status command handler.
# Replies with host facts from windows/info.py. Runs only after the
# authorization gate in discord_bot.py passes.

from __future__ import annotations

from astral_relay.agent.windows.info import format_status, get_status


async def handle_status(ctx, config: dict) -> None:
    """Handle the command. No side effects besides reading host facts."""
    snapshot = get_status(config.get("agentVersion", ""), True)
    await ctx.send(format_status(snapshot))
