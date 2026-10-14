# Per-computer Discord category setup.
# On startup the agent ensures each visible guild has a category named
# after this computer (hostname + short host ID) so operators can tell
# managed computers apart at a glance. Lookup is by exact deterministic
# name, so reruns never create duplicates. Missing Manage Channels
# permission or HTTP failures only warn; the agent keeps running.
# Contains no slash-command logic; prefix-only operation is unaffected.

from __future__ import annotations

MAX_CATEGORY_NAME = 100


def host_category_name(hostname: str, host_id: str) -> str:
    """Build the deterministic category name for this computer."""
    host = (hostname or "unknown-host").strip() or "unknown-host"
    hid = (host_id or "unknown-id").strip() or "unknown-id"
    name = f"pc {host} ({hid})"
    if len(name) > MAX_CATEGORY_NAME:
        keep = MAX_CATEGORY_NAME - len(f"pc  ({hid})") - 1
        name = f"pc {host[:max(keep, 1)]}… ({hid})"
    return name


async def ensure_host_category(guild, hostname: str, host_id: str):
    """Find or create this computer's category in a guild.

    Returns the category, or None when it cannot be ensured (no
    permission, HTTP error). Never raises.
    """
    from astral_relay.shared.logging_utils import warn

    name = host_category_name(hostname, host_id)
    try:
        existing = [c for c in (getattr(guild, "categories", []) or []) if getattr(c, "name", "") == name]
    except Exception:
        existing = []
    if existing:
        return existing[0]
    try:
        return await guild.create_category(name, reason="AstralRelay host identification")
    except Exception as err:  # noqa: BLE001 - Forbidden/HTTP failures only warn
        warn("Host category unavailable.", {"guild": getattr(guild, "id", "?"), "message": str(err)})
        return None


async def ensure_host_categories(bot, hostname: str, host_id: str) -> int:
    """Ensure the host category in every visible guild. Returns guild count attempted."""
    guilds = list(getattr(bot, "guilds", []) or [])
    for guild in guilds:
        try:
            await ensure_host_category(guild, hostname, host_id)
        except Exception:
            continue
    return len(guilds)
