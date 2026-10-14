# One-time migration utility: remove obsolete global and guild-scoped
# /pc slash commands left by the previous Node.js application.
# Explicit operator action only. Never runs during agent startup.
# Token via masked interactive input; never argv, env, logs, or filenames.

from __future__ import annotations

import asyncio
import sys


def _prompt_token() -> str:
    from astral_relay.agent.secure_input import prompt_for_token

    return prompt_for_token()


async def _clear(token: str) -> int:
    import discord

    from astral_relay.shared.logging_utils import error, info

    intents = discord.Intents.default()
    intents.guilds = True
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready() -> None:
        try:
            assert client.user is not None
            print(f"Logged in as {client.user} ({client.user.id}).")
            print("Type YES to delete obsolete global and guild /pc commands, anything else aborts:")
            answer = sys.stdin.readline().strip()
            if answer != "YES":
                print("Aborted; no changes made.")
                await client.close()
                return
            tree_types = "app_commands"
            removed_global = 0
            try:
                from discord import app_commands

                tree = app_commands.CommandTree(client)
                await tree.fetch_commands()
                for cmd in list(tree._commands.values()) if hasattr(tree, "_commands") else []:
                    if getattr(cmd, "name", "") == "pc":
                        tree.remove_command(cmd.name)
                        removed_global += 1
                await tree.sync()
            except Exception as exc:  # noqa: BLE001 - reported, redacted by logger
                error("Global command cleanup failed.", {"message": str(exc)})
            removed_guild = 0
            for guild in list(getattr(client, "guilds", [])):
                try:
                    commands = await guild.fetch_commands()
                    for cmd in commands:
                        if getattr(cmd, "name", "") == "pc":
                            await cmd.delete()
                            removed_guild += 1
                except Exception as exc:  # noqa: BLE001
                    error("Guild command cleanup failed.", {"guild": getattr(guild, "id", "?"),
                                                            "message": str(exc)})
            print(f"Removed {removed_global} global and {removed_guild} guild /pc commands.")
            print(f"Unrelated commands preserved ({tree_types} untouched except name == pc).")
            info("Slash cleanup done.")
        finally:
            await client.close()

    await client.start(token)
    return 0


def main() -> int:
    try:
        token = _prompt_token()
    except KeyboardInterrupt:
        print("Bye.")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Aborted: {exc}")
        return 1
    try:
        return asyncio.run(_clear(token))
    except KeyboardInterrupt:
        print("Bye.")
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"Cleanup failed: {exc}")
        return 1
    finally:
        token = ""


if __name__ == "__main__":
    raise SystemExit(main())
