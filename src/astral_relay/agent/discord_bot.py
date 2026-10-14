# Discord prefix-command bot wiring: login, routing, shutdown.
# Production agent entry calls start_bot() after the token is available.
# Commands use the ! prefix through a `pc` group: !pc status, !pc apps,
# !pc open <id>, !pc lock. No slash commands, no CommandTree, no
# application-command registration or synchronization live here; obsolete
# slash commands are removed once by scripts/clear_slash_commands.py.
# Every routing path calls require_authorized before any Windows
# operation. Prefix replies are ordinary messages, so failure text stays
# generic and never carries system details.

from __future__ import annotations

import asyncio
from typing import Any

from astral_relay.agent.commands.apps_cmd import handle_apps
from astral_relay.agent.commands.lock_cmd import handle_lock
from astral_relay.agent.commands.open_cmd import handle_open
from astral_relay.agent.commands.status_cmd import handle_status
from astral_relay.agent.security.authorize import require_authorized
from astral_relay.agent.windows.apps import discover_catalog
from astral_relay.shared.errors import AuthError, ConfigError
from astral_relay.shared.logging_utils import error, info

COMMAND_PREFIX = "!"
USAGE = "Usage: !pc status | !pc apps [query] | !pc open <id> | !pc lock"


def build_bot(config: dict, catalog_fn=None):
    """Create the prefix-command bot. discord.py imports stay local to this function."""
    import discord
    from discord.ext import commands

    intents = discord.Intents.default()
    intents.guilds = True
    intents.message_content = True

    bot = commands.Bot(command_prefix=COMMAND_PREFIX, intents=intents, case_insensitive=True, help_command=None)
    discover = catalog_fn if catalog_fn is not None else discover_catalog

    def auth_source_of(ctx) -> dict[str, Any]:
        guild = getattr(ctx, "guild", None)
        author = getattr(ctx, "author", None)
        permissions = getattr(author, "guild_permissions", None)
        bits = getattr(permissions, "value", None) if permissions is not None else None
        return {"inGuild": guild is not None, "permissions": bits}

    def is_dm(ctx) -> bool:
        return getattr(ctx, "guild", None) is None

    async def fresh_catalog() -> list:
        try:
            result = discover()
            if asyncio.iscoroutine(result):
                result = await result
            if isinstance(result, dict) and isinstance(result.get("apps"), list):
                return result["apps"]
            if isinstance(result, list):
                return result
            return []
        except Exception:
            return []

    async def deny(ctx) -> bool:
        """Run the gate. Returns True when the request was denied."""
        try:
            require_authorized(auth_source_of(ctx), config)
            return False
        except AuthError:
            error("Rejected unauthorized command.")
            try:
                if is_dm(ctx):
                    await ctx.send("Commands unavailable in DMs.")
                else:
                    await ctx.send("Not authorized.")
            except Exception:
                pass
            return True

    @bot.event
    async def on_ready() -> None:
        content = getattr(bot.intents, "message_content", False)
        if not content:
            error("Message Content Intent unavailable; prefix commands will be ignored. "
                  "Enable it in code and in the Developer Portal.")
        from astral_relay.agent.discord_setup import ensure_host_categories
        from astral_relay.agent.windows.info import get_hostname, get_machine_id

        try:
            await ensure_host_categories(bot, get_hostname(), get_machine_id())
        except Exception:
            pass
        info("Discord client ready.")

    @bot.event
    async def on_command_error(ctx, exc) -> None:
        if is_dm(ctx):
            try:
                await ctx.send("Commands unavailable in DMs.")
            except Exception:
                pass
            return
        try:
            from discord.ext.commands import CommandNotFound, MissingRequiredArgument, BadArgument

            if isinstance(exc, (CommandNotFound, MissingRequiredArgument, BadArgument)):
                await ctx.send(USAGE)
                return
        except ImportError:
            pass
        error("Command handler failed.")
        try:
            await ctx.send("Command failed.")
        except Exception:
            pass

    @bot.group(name="pc", invoke_without_command=True, case_insensitive=True)
    async def pc(ctx) -> None:
        if ctx.invoked_subcommand is None:
            if await deny(ctx):
                return
            await ctx.send(USAGE)

    # Explicit case-insensitive subcommand lookup: discord.py applies
    # Bot(case_insensitive=True) to top-level names, but group child
    # lookup is verified here instead of assumed. The override below
    # lowercases child names so !PC STATUS and !Pc OpEn match.
    _original_get_command = pc.get_command if hasattr(pc, "get_command") else None

    def _casefold_get_command(name: str):
        if _original_get_command is None:
            return None
        found = _original_get_command(name)
        if found is None and isinstance(name, str):
            found = _original_get_command(name.lower())
        return found

    if _original_get_command is not None:
        try:
            pc.get_command = _casefold_get_command  # type: ignore[method-assign]
        except (AttributeError, TypeError):
            pass

    @pc.command(name="status")
    async def pc_status(ctx) -> None:
        if await deny(ctx):
            return
        try:
            await handle_status(ctx, config)
        except Exception:
            error("Command handler failed.", {"sub": "status"})
            await ctx.send("Command failed.")

    @pc.command(name="apps")
    async def pc_apps(ctx, *, query: str = "") -> None:
        if await deny(ctx):
            return
        try:
            await handle_apps(ctx, await fresh_catalog(), query or "")
        except Exception:
            error("Command handler failed.", {"sub": "apps"})
            await ctx.send("Command failed.")

    @pc.command(name="open")
    async def pc_open(ctx, picked: str = "") -> None:
        if await deny(ctx):
            return
        if not picked:
            await ctx.send(USAGE)
            return
        try:
            await handle_open(ctx, await fresh_catalog(), picked)
        except Exception:
            error("Command handler failed.", {"sub": "open"})
            await ctx.send("Command failed.")

    @pc.command(name="lock")
    async def pc_lock(ctx) -> None:
        if await deny(ctx):
            return
        try:
            await handle_lock(ctx)
        except Exception:
            error("Command handler failed.", {"sub": "lock"})
            await ctx.send("Command failed.")

    return bot


async def start_bot(config: dict, token: str, catalog_fn=None):
    """Log in and run until interrupted. Caller owns shutdown signaling."""
    enabled = set(config.get("enabledCommands") or [])
    if not enabled:
        raise ConfigError("enabledCommands must list at least one command.")
    bot = build_bot(config, catalog_fn=catalog_fn)
    info("Logging in to Discord.")
    await bot.start(token.strip())
    return bot
