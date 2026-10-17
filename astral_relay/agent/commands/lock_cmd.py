# !pc lock command handler.
# Locks the Windows session via windows/lock.py. Reports safe error
# text when the operation cannot complete.

from __future__ import annotations

from astral_relay.agent.windows.lock import lock_session


async def handle_lock(ctx) -> None:
    """Handle the command. Authorization already checked by caller."""
    try:
        lock_session()
        await ctx.send("Session locked.")
    except Exception as err:  # noqa: BLE001 - message text is user-safe by construction
        await ctx.send(f"Could not lock: {err}")
