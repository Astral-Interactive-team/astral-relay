# Centralized command authorization gate.
# Every incoming prefix command passes here before any Windows operation
# runs. Requires guild context plus member permission bits for the
# configured flag. Administrator bypasses the minimum, ordinary members
# are denied, DMs (no guild) are denied. Pure function over plain data.
# Ported from src/agent/security/authorize.js.

from __future__ import annotations

from typing import Any

from astral_relay.shared.config import VALID_PERMISSIONS
from astral_relay.shared.errors import AuthError

# Discord permission bit values mirrored from discord.py Permissions.
# discord.py is the authoritative resolver at runtime; this table keeps
# the gate unit-testable without importing discord.
_PERMISSION_BITS: dict[str, int] = {
    "Administrator": 1 << 3,
    "ManageGuild": 1 << 5,
    "ManageRoles": 1 << 28,
    "ManageChannels": 1 << 4,
    "ManageMessages": 1 << 13,
    "ManageThreads": 1 << 34,
    "ManageEvents": 1 << 33,
    "ManageNicknames": 1 << 27,
    "ModerateMembers": 1 << 40,
    "ManageWebhooks": 1 << 29,
    "ViewAuditLog": 1 << 7,
    "KickMembers": 1 << 1,
    "BanMembers": 1 << 2,
}


def resolve_permission_bit(name: Any) -> int | None:
    """Resolve a permission flag name to its bit. None when unknown (fail closed)."""
    if not isinstance(name, str):
        return None
    if name not in VALID_PERMISSIONS:
        return None
    # Prefer live discord.py flag values when importable so bit values
    # can never drift from the library; fall back to the static table.
    try:
        import discord

        valid = getattr(discord.Permissions, "VALID_FLAGS", None)
        if isinstance(valid, dict) and isinstance(valid.get(name), int):
            return valid[name]
    except ImportError:
        pass
    return _PERMISSION_BITS.get(name)


def is_authorized(source: Any, config: Any) -> bool:
    """Return True when source is a guild context holding the required permission."""
    if not isinstance(source, dict) or not isinstance(config, dict):
        return False
    if source.get("inGuild") is not True:
        return False
    permissions = source.get("permissions")
    if permissions is None:
        return False
    try:
        bits = int(permissions)
    except (TypeError, ValueError):
        return False
    required = resolve_permission_bit(config.get("requiredPermission"))
    if required is None:
        return False
    if (bits & required) == required:
        return True
    admin = _PERMISSION_BITS["Administrator"]
    return (bits & admin) == admin


def require_authorized(source: Any, config: Any) -> None:
    """Throw AuthError unless authorized. Call at the top of each command handler."""
    if not is_authorized(source, config):
        raise AuthError("Unauthorized: guild context plus management permission required.")
