# Unit tests for per-computer category setup. Fakes only, no network.

import asyncio

import pytest

pytest.importorskip("discord")

from astral_relay.agent.discord_setup import (
    ensure_host_categories,
    ensure_host_category,
    host_category_name,
)


class FakeCategory:
    def __init__(self, name):
        self.name = name


class FakeGuild:
    def __init__(self, guild_id=1, categories=None, fail=None):
        self.id = guild_id
        self.categories = list(categories or [])
        self.created = []
        self.fail = fail

    async def create_category(self, name, reason=None):
        if self.fail is not None:
            raise self.fail
        category = FakeCategory(name)
        self.categories.append(category)
        self.created.append(name)
        return category


def _run(coro):
    return asyncio.run(coro)


def test_name_format_and_cap():
    assert host_category_name("DESKTOP-1", "a1b2c3d4") == "pc DESKTOP-1 (a1b2c3d4)"
    assert host_category_name("", "") == "pc unknown-host (unknown-id)"
    assert len(host_category_name("H" * 200, "a1b2c3d4")) <= 100


def test_finds_existing_without_creating():
    guild = FakeGuild(categories=[FakeCategory("pc HOST (id)")])
    found = _run(ensure_host_category(guild, "HOST", "id"))
    assert found.name == "pc HOST (id)"
    assert guild.created == []


def test_creates_when_absent():
    guild = FakeGuild()
    found = _run(ensure_host_category(guild, "HOST", "id"))
    assert found.name == "pc HOST (id)"
    assert guild.created == ["pc HOST (id)"]


def test_permission_failure_warns_without_raising():
    class Forbidden(Exception):
        pass

    guild = FakeGuild(fail=Forbidden("Missing Permissions"))
    assert _run(ensure_host_category(guild, "HOST", "id")) is None
    assert guild.created == []


def test_covers_every_guild_and_counts():
    guilds = [FakeGuild(1), FakeGuild(2, fail=RuntimeError("gone"))]

    class FakeBot:
        pass

    bot = FakeBot()
    bot.guilds = guilds
    assert _run(ensure_host_categories(bot, "HOST", "id")) == 2
    assert guilds[0].created == ["pc HOST (id)"]
