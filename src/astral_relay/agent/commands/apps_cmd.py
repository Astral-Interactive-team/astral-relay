# !pc apps command handler.
# Searches the live catalog by optional query text and replies with a
# list. Read-only; nothing launches here.

from __future__ import annotations

from astral_relay.agent.windows.apps import format_apps_list, search_catalog


async def handle_apps(ctx, catalog: list, query: str = "") -> None:
    """Handle the command. Authorization already checked by caller."""
    matches = search_catalog(catalog, query)
    await ctx.send(format_apps_list(matches, len(catalog)))
