# Guard test: the agent exposes no Discord commands.
# The !pc command group and everything that existed only to serve it were
# removed: the command handlers, the authorization gate, the Start Menu
# application catalog and launcher, the session lock helper, and the
# enabledCommands/requiredPermission configuration keys. This test fails
# loudly if any of that surface is reintroduced.

import importlib.util

from astral_relay.shared.config import default_runtime_config, validate_config


def _spec_or_none(name: str):
    """Return the module spec, or None when the module is not importable."""
    try:
        return importlib.util.find_spec(name)
    except ModuleNotFoundError:
        return None


def test_removed_command_modules_are_not_importable():
    for name in (
        "astral_relay.agent.commands",
        "astral_relay.agent.commands.status_cmd",
        "astral_relay.agent.commands.apps_cmd",
        "astral_relay.agent.commands.open_cmd",
        "astral_relay.agent.commands.lock_cmd",
        "astral_relay.agent.security",
        "astral_relay.agent.security.authorize",
        "astral_relay.agent.windows.apps",
        "astral_relay.agent.windows.lock",
    ):
        assert _spec_or_none(name) is None, name


def test_bot_registers_no_prefix_command_machinery():
    from pathlib import Path

    from astral_relay.agent import discord_bot

    text = Path(discord_bot.__file__).read_text(encoding="utf-8")
    for forbidden in ("command_prefix", "process_commands", "add_command", "on_command_error"):
        assert forbidden not in text, forbidden
    assert "no commands" in text


def test_config_schema_has_no_command_or_permission_fields():
    defaults = default_runtime_config()
    assert "enabledCommands" not in defaults
    assert "requiredPermission" not in defaults
    assert validate_config(defaults) == []
