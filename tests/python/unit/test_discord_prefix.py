# Unit tests for the prefix-command bot: routing, authz, arg validation,
# case-insensitivity, DM behavior, intent diagnostics, and the managed
# #info auto-delete listener.
# Uses discord.py with fake contexts; no network contact.

import asyncio
from types import SimpleNamespace

import pytest

pytest.importorskip("discord")

from astral_relay.agent import discord_bot as bot_mod
from astral_relay.shared.config import default_runtime_config

MANAGE_GUILD = 1 << 5
ADMIN = 1 << 3


class FakePermissions:
    def __init__(self, value):
        self.value = value


class FakeAuthor:
    def __init__(self, bits):
        self.guild_permissions = FakePermissions(bits)


class FakeGuild:
    id = 123


class FakeCtx:
    def __init__(self, bits=MANAGE_GUILD, guild=True):
        self.author = FakeAuthor(bits)
        self.guild = FakeGuild() if guild else None
        self.sent: list = []
        self.invoked_subcommand = None

    async def send(self, text):
        self.sent.append(text)


def _run(coro):
    return asyncio.run(coro)


def _config(**overrides):
    cfg = default_runtime_config()
    cfg.update(overrides)
    return cfg


def test_bot_requests_minimum_intents():
    bot = bot_mod.build_bot(_config())
    assert bot.intents.guilds is True
    assert bot.intents.message_content is True
    assert bot.command_prefix == "!"


def test_status_replies_with_facts():
    bot = bot_mod.build_bot(_config())
    cmd = bot.get_command("pc status") or bot.get_command("pc").get_command("status")
    ctx = FakeCtx()
    _run(cmd.callback(ctx))
    assert any("Status:" in m for m in ctx.sent)


def test_apps_lists_catalog():
    bot = bot_mod.build_bot(_config(), catalog_fn=lambda: {"apps": [
        {"id": "a1", "name": "Notepad", "folder": ".", "available": True}]})
    cmd = bot.get_command("pc").get_command("apps")
    ctx = FakeCtx()
    _run(cmd.callback(ctx, query=""))
    assert any("Notepad" in m for m in ctx.sent)


def test_open_validates_id_only():
    catalog = [{"id": "a1", "name": "Tool", "folder": ".", "available": True,
                "target": "C:\\nonexistent\\t.exe", "unresolved": False}]
    bot = bot_mod.build_bot(_config(), catalog_fn=lambda: {"apps": catalog})
    cmd = bot.get_command("pc").get_command("open")
    ctx = FakeCtx()
    _run(cmd.callback(ctx, picked="nope"))
    assert any("Unknown selection" in m for m in ctx.sent)
    ctx2 = FakeCtx()
    _run(cmd.callback(ctx2, picked=""))
    assert any("Usage" in m for m in ctx2.sent)


def test_lock_replies():
    bot = bot_mod.build_bot(_config())
    cmd = bot.get_command("pc").get_command("lock")
    ctx = FakeCtx()
    _run(cmd.callback(ctx))
    assert len(ctx.sent) == 1
    assert "locked" in ctx.sent[0].lower() or "could not" in ctx.sent[0].lower()


def test_reconnect_counter_starts_at_zero_and_counts_resumes():
    bot = bot_mod.build_bot(_config())
    assert bot._astral_reconnects == 0
    _run(bot.on_resumed())
    _run(bot.on_resumed())
    assert bot._astral_reconnects == 2


def test_unauthorized_member_denied():
    bot = bot_mod.build_bot(_config())
    cmd = bot.get_command("pc").get_command("status")
    ctx = FakeCtx(bits=0)
    _run(cmd.callback(ctx))
    assert ctx.sent == ["Not authorized."]


def test_dm_denied_with_dm_message():
    bot = bot_mod.build_bot(_config())
    cmd = bot.get_command("pc").get_command("status")
    ctx = FakeCtx(guild=False)
    _run(cmd.callback(ctx))
    assert ctx.sent == ["Commands unavailable in DMs."]


def test_admin_bypass():
    bot = bot_mod.build_bot(_config())
    cmd = bot.get_command("pc").get_command("status")
    ctx = FakeCtx(bits=ADMIN)
    _run(cmd.callback(ctx))
    assert any("Status:" in m for m in ctx.sent)


def test_case_insensitive_group_and_subcommands():
    bot = bot_mod.build_bot(_config())
    group = bot.get_command("PC")
    assert group is not None
    assert group.get_command("STATUS") is not None
    assert group.get_command("StAtUs") is not None
    assert group.get_command("nope") is None


def test_no_slash_registration_in_bot():
    import inspect

    source = inspect.getsource(bot_mod)
    assert "CommandTree(" not in source
    assert "tree.sync(" not in source
    assert "import app_commands" not in source
    assert "add_application_command" not in source


class FakeInfoMessage:
    def __init__(self, channel_id, bot_author=False, deletable=True):
        self.channel = SimpleNamespace(id=channel_id)
        self.author = SimpleNamespace(bot=bot_author)
        self.deleted = False
        self.deletable = deletable

    async def delete(self):
        if not self.deletable:
            raise RuntimeError("Missing Permissions")
        self.deleted = True


def test_info_channel_deletes_member_messages(monkeypatch):
    import astral_relay.agent.discord_setup as setup

    monkeypatch.setattr(setup, "is_info_channel", lambda channel_id: channel_id == 777)
    bot = bot_mod.build_bot(_config())
    processed = []

    async def fake_process(message):
        processed.append(message)

    monkeypatch.setattr(bot, "process_commands", fake_process)

    message = FakeInfoMessage(777)
    _run(bot.on_message(message))
    assert message.deleted is True
    assert processed == []


def test_info_channel_ignores_undeletable_message(monkeypatch):
    import astral_relay.agent.discord_setup as setup

    monkeypatch.setattr(setup, "is_info_channel", lambda channel_id: True)
    bot = bot_mod.build_bot(_config())

    async def fake_process(message):  # pragma: no cover - must not run
        raise AssertionError("commands must not run in #info")

    monkeypatch.setattr(bot, "process_commands", fake_process)

    message = FakeInfoMessage(777, deletable=False)
    _run(bot.on_message(message))
    assert message.deleted is False


def test_bot_messages_and_other_channels_reach_commands(monkeypatch):
    import astral_relay.agent.discord_setup as setup

    monkeypatch.setattr(setup, "is_info_channel", lambda channel_id: channel_id == 777)
    bot = bot_mod.build_bot(_config())
    processed = []

    async def fake_process(message):
        processed.append(message)

    monkeypatch.setattr(bot, "process_commands", fake_process)

    bot_echo = FakeInfoMessage(777, bot_author=True)  # our own panel message
    elsewhere = FakeInfoMessage(42)
    _run(bot.on_message(bot_echo))
    _run(bot.on_message(elsewhere))
    assert bot_echo.deleted is False
    assert elsewhere.deleted is False
    assert processed == [bot_echo, elsewhere]
