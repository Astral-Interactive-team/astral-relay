# !pc open command handler.
# Argument carries the catalog stable ID, never a path or name. The
# handler resolves the ID against a fresh local catalog, so only
# discovered entries launch and free-typed text is rejected.

from __future__ import annotations

from astral_relay.agent.windows.apps import launch_app, resolve_by_id


async def handle_open(ctx, catalog: list, picked: str) -> None:
    """Handle the command. Authorization already checked by caller."""
    entry = resolve_by_id(catalog, picked)
    if entry is None:
        await ctx.send("Unknown selection. Pick one from the apps list.")
        return
    try:
        started = launch_app(entry)
        await ctx.send(f'Launched "{started}".')
    except Exception as err:  # noqa: BLE001 - message text is user-safe by construction
        await ctx.send(f"Could not launch: {err}")
