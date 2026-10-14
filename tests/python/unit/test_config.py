# Unit tests for configuration schema and validation.
# Mirrors tests/config.test.js behavior.

from astral_relay.shared.config import (
    DEFAULT_PERMISSION,
    VALID_COMMANDS,
    VALID_PERMISSIONS,
    default_runtime_config,
    permission_note,
    require_valid_config,
    validate_config,
)
from astral_relay.shared.errors import ConfigError
import pytest


def test_defaults_pass_with_zero_user_input():
    assert validate_config(default_runtime_config()) == []


def test_accepts_good_config():
    cfg = {"requiredPermission": "Administrator", "enabledCommands": ["status", "lock"], "agentVersion": "0.1.0"}
    assert validate_config(cfg) == []


def test_rejects_unknown_permission_and_empty_version():
    problems = validate_config({"requiredPermission": "Nope", "enabledCommands": ["status"], "agentVersion": ""})
    assert any("requiredPermission" in p for p in problems)
    assert any("agentVersion" in p for p in problems)


def test_rejects_unknown_command():
    problems = validate_config({"requiredPermission": DEFAULT_PERMISSION, "enabledCommands": ["nope"], "agentVersion": "0.1.0"})
    assert any("unknown command" in p for p in problems)


def test_rejects_removed_ids():
    for legacy in ("guildId", "applicationId", "authorizedUserIds", "allowedApps"):
        cfg = dict(default_runtime_config())
        cfg[legacy] = "x"
        assert any(legacy in p for p in validate_config(cfg))


def test_rejects_embedded_token_fields():
    for key in ("botToken", "token"):
        cfg = dict(default_runtime_config())
        cfg[key] = "x"
        assert any("token" in p.lower() for p in validate_config(cfg))


def test_require_valid_config_throws_config_error():
    with pytest.raises(ConfigError):
        require_valid_config({"requiredPermission": "Nope"})
    assert require_valid_config(default_runtime_config()) is not None


def test_permission_notes_cover_every_flag():
    for name in VALID_PERMISSIONS:
        assert permission_note(name)
    assert permission_note("Nope") is None
    assert set(VALID_COMMANDS) == {"status", "open", "apps", "lock"}
