# Unit tests for the authorization gate. Mirrors tests/authorize.test.js
# truth table plus numeric-string bitfields from the gateway.

import pytest

from astral_relay.agent.security.authorize import is_authorized, require_authorized, resolve_permission_bit
from astral_relay.shared.config import DEFAULT_PERMISSION
from astral_relay.shared.errors import AuthError

MANAGE_GUILD = 1 << 5
ADMIN = 1 << 3


def _cfg(perm=DEFAULT_PERMISSION):
    from astral_relay.shared.config import default_runtime_config

    cfg = default_runtime_config()
    cfg["requiredPermission"] = perm
    return cfg


def test_resolves_known_flag():
    assert resolve_permission_bit("ManageGuild") == MANAGE_GUILD
    assert resolve_permission_bit("NoSuchPerm") is None


def test_accepts_manager_in_any_guild():
    assert is_authorized({"inGuild": True, "permissions": MANAGE_GUILD}, _cfg()) is True


def test_denies_ordinary_member():
    assert is_authorized({"inGuild": True, "permissions": 0}, _cfg()) is False


def test_denies_dm_without_guild_context():
    assert is_authorized({"inGuild": False, "permissions": MANAGE_GUILD}, _cfg()) is False
    assert is_authorized({"inGuild": None, "permissions": MANAGE_GUILD}, _cfg()) is False


def test_accepts_administrator_without_required_flag():
    assert is_authorized({"inGuild": True, "permissions": ADMIN}, _cfg()) is True


def test_accepts_numeric_string_bitfield():
    assert is_authorized({"inGuild": True, "permissions": str(MANAGE_GUILD)}, _cfg()) is True


def test_denies_unknown_configured_flag():
    assert is_authorized({"inGuild": True, "permissions": MANAGE_GUILD}, _cfg("Nope")) is False


def test_denies_malformed_source():
    assert is_authorized(None, _cfg()) is False
    assert is_authorized({"inGuild": True}, _cfg()) is False
    assert is_authorized({"inGuild": True, "permissions": "junk"}, _cfg()) is False


def test_require_authorized_throws_auth_error():
    with pytest.raises(AuthError):
        require_authorized({"inGuild": True, "permissions": 0}, _cfg())
    require_authorized({"inGuild": True, "permissions": MANAGE_GUILD}, _cfg())
