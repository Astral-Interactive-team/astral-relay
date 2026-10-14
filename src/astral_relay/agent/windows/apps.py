# Windows application discovery and safe launcher for !pc open.
# Catalog comes from Start Menu shortcuts (*.lnk) in the all-users and
# per-user Programs folders, parsed locally on every use. Only shortcuts
# whose target is a local .exe file resolve; Store apps, URLs, GUID
# objects, applets, and broken links are skipped safely.
# Identity is a stable ID (hash of shortcut path); free-typed text never
# matches. Launch re-validates and stats the target on every call, spawns
# detached without shell and without remote arguments.
# Ported from src/agent/windows/apps.js.

from __future__ import annotations

import base64
import hashlib
import os
import struct
import subprocess
from pathlib import Path

LNK_EXT = ".lnk"
EXE_EXT = ".exe"
AUTOCOMPLETE_LIMIT = 25
LIST_LIMIT = 15

_RESOLVER_PS = (
    "$ErrorActionPreference='SilentlyContinue';"
    "$lines=@($input|ForEach-Object{try{[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_.Trim()))}catch{''}}|Where-Object{$_ -ne ''});"
    "$s=New-Object -ComObject WScript.Shell;"
    "foreach($p in $lines){$t='';try{$t=[string]$s.CreateShortcut($p).TargetPath}catch{};"
    "$a=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p));"
    "$b=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t));"
    "Write-Output ($a+' '+$b)}"
)


def get_start_menu_dirs(env=None) -> list[str]:
    """Return Start Menu Programs folders to scan. Env injectable for tests."""
    source = env if env is not None else os.environ
    dirs: list[str] = []
    if source.get("ProgramData"):
        dirs.append(str(Path(source["ProgramData"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs"))
    if source.get("APPDATA"):
        dirs.append(str(Path(source["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs"))
    return dirs


def stable_id(shortcut_path: str) -> str:
    """Hash a shortcut path into a short stable ID. Lowercased first."""
    return hashlib.sha1(str(shortcut_path).lower().encode("utf-8")).hexdigest()[:12]


def _read_link_info(data: bytes):
    if not isinstance(data, (bytes, bytearray)) or len(data) < 78:
        return None
    if struct.unpack_from("<I", data, 0)[0] != 0x4C:
        return None
    flags = struct.unpack_from("<I", data, 20)[0]
    pos = 76
    if flags & 0x01:
        if pos + 2 > len(data):
            return None
        pos += 2 + struct.unpack_from("<H", data, pos)[0]
    if not (flags & 0x02):
        return None
    if pos + 28 > len(data):
        return None
    info_size = struct.unpack_from("<I", data, pos)[0]
    info_header = struct.unpack_from("<I", data, pos + 4)[0]
    if info_size < 28 or info_header < 28 or pos + info_size > len(data):
        return None
    info_flags = struct.unpack_from("<I", data, pos + 8)[0]
    if not (info_flags & 0x01):
        return None

    def read_utf16(at: int) -> str:
        if at < 36 or pos + at + 2 > pos + info_size:
            return ""
        start = pos + at
        end = start
        while end + 2 <= pos + info_size and struct.unpack_from("<H", data, end)[0] != 0:
            end += 2
        return bytes(data[start:end]).decode("utf-16-le", errors="strict")

    unicode_base = ""
    unicode_suffix = ""
    if info_header >= 36 and pos + 36 <= pos + info_size:
        try:
            unicode_base = read_utf16(struct.unpack_from("<I", data, pos + 28)[0])
            unicode_suffix = read_utf16(struct.unpack_from("<I", data, pos + 32)[0])
        except (UnicodeDecodeError, struct.error):
            return None
    ansi_base_offset = struct.unpack_from("<I", data, pos + 16)[0]
    has_ansi_base = 0 < ansi_base_offset and pos + ansi_base_offset < pos + info_size
    return {"unicodeBase": unicode_base, "unicodeSuffix": unicode_suffix, "hasAnsiBase": has_ansi_base}


def parse_lnk_target(data: bytes) -> str | None:
    """Extract the local target path from .lnk bytes via Unicode fields.

    Returns an absolute path string or None when no reliable Unicode
    target exists or bytes are malformed. ANSI-only shortcuts return None
    and go through the Windows-native resolver instead.
    """
    info = _read_link_info(data)
    if info is None:
        return None
    base = info["unicodeBase"]
    if base == "":
        return None
    suffix = info["unicodeSuffix"]
    if suffix != "" and not base.endswith("\\"):
        return base + "\\" + suffix
    return base + suffix


def needs_native_resolve(data: bytes) -> bool:
    """Report whether bytes hold an ANSI-only local target needing native lookup."""
    info = _read_link_info(data)
    if info is None:
        return False
    return info["unicodeBase"] == "" and info["hasAnsiBase"]


def resolve_ansi_targets(shortcut_paths, spawn_fn=None, timeout_s: float = 60.0) -> dict:
    """Resolve ANSI-only shortcuts through one native PowerShell batch call.

    Returns a map of shortcut path to resolved target (possibly '').
    Any failure yields an empty map so callers mark entries unavailable.
    """
    seen: dict = {}
    paths: list[str] = []
    for item in shortcut_paths or []:
        if isinstance(item, str) and item != "" and item not in seen:
            seen[item] = True
            paths.append(item)
    if not paths:
        return {}
    script_b64 = base64.b64encode(_RESOLVER_PS.encode("utf-16-le")).decode("ascii")
    runner = spawn_fn if spawn_fn is not None else subprocess.run
    try:
        if runner is subprocess.run:
            # Paths travel as UTF-8 base64 lines so locale pipes (cp949)
            # can never fail on non-ASCII shortcut paths.
            payload = "\n".join(base64.b64encode(p.encode("utf-8")).decode("ascii") for p in paths)
            proc = runner(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                 "-EncodedCommand", script_b64],
                input=payload, capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=timeout_s, shell=False,
            )
            output = proc.stdout or ""
        else:
            output = runner(paths)
            if output is None:
                return {}
            output = str(output)
    except Exception:
        return {}
    if len(output) > 10 * 1024 * 1024:
        output = output[: 10 * 1024 * 1024]
    result: dict = {}
    for raw in output.split("\n"):
        line = raw[:-1] if raw.endswith("\r") else raw
        if line.strip() == "":
            continue
        space = line.find(" ")
        if space < 0:
            continue
        try:
            shortcut = base64.b64decode(line[:space]).decode("utf-8")
            target = base64.b64decode(line[space + 1 :].strip()).decode("utf-8")
            if shortcut != "":
                result[shortcut] = target
        except Exception:
            continue
    return result


def _blocking_entry(shortcut_path: str, scope: str, root: str, target, unresolved: bool) -> dict:
    name = Path(shortcut_path).stem
    available = False
    if target is not None:
        try:
            available = Path(target).is_file()
        except OSError:
            available = False
    try:
        folder = os.path.dirname(os.path.relpath(shortcut_path, root))
    except ValueError:
        folder = ""
    return {
        "id": stable_id(shortcut_path),
        "name": name,
        "folder": folder,
        "scope": scope,
        "shortcut": shortcut_path,
        "target": target,
        "available": available,
        "unresolved": unresolved,
    }


def _collect_shortcuts(directory: str, out: list) -> None:
    try:
        entries = list(Path(directory).rglob(f"*{LNK_EXT}"))
    except OSError:
        return
    for item in entries:
        try:
            if item.is_file():
                out.append(str(item))
        except OSError:
            continue


def discover_catalog(dirs=None, resolve_ansi=None) -> dict:
    """Discover installed apps from Start Menu folders.

    Returns {apps, skipped}. Unresolvable entries stay listed as
    unavailable (never launched). Missing folders yield empty results.
    """
    resolver = resolve_ansi if callable(resolve_ansi) else resolve_ansi_targets
    roots = list(dirs) if dirs is not None else get_start_menu_dirs()
    apps: list[dict] = []
    skipped = 0
    seen: set[str] = set()
    pending: list[tuple] = []
    for directory in roots or []:
        scope = "all-users" if "programdata" in str(directory).lower() else "per-user"
        found: list[str] = []
        _collect_shortcuts(str(directory), found)
        for shortcut in found:
            pending.append((shortcut, scope, str(directory)))
    cached: dict = {}
    ansi_queue: list[str] = []
    loaded: list[tuple] = []
    for shortcut, scope, root in pending:
        try:
            with open(shortcut, "rb") as handle:
                data = handle.read()
        except OSError:
            skipped += 1
            continue
        loaded.append((shortcut, scope, root, data))
        if parse_lnk_target(data) is None and needs_native_resolve(data):
            ansi_queue.append(shortcut)
    if ansi_queue:
        try:
            resolved = resolver(ansi_queue)
            if isinstance(resolved, dict):
                cached.update(resolved)
        except Exception:
            pass
    for shortcut, scope, root, data in loaded:
        direct = parse_lnk_target(data)
        name = Path(shortcut).stem
        if direct is not None:
            if not direct.lower().endswith(EXE_EXT):
                skipped += 1
                continue
            entry = _blocking_entry(shortcut, scope, root, direct, False)
        elif not needs_native_resolve(data):
            skipped += 1
            continue
        else:
            resolved = cached.get(shortcut)
            if not isinstance(resolved, str) or resolved == "" or not resolved.lower().endswith(EXE_EXT):
                entry = _blocking_entry(shortcut, scope, root, None, True)
            else:
                entry = _blocking_entry(shortcut, scope, root, resolved, False)
        if name.strip() == "":
            skipped += 1
            continue
        if entry["id"] in seen:
            continue
        seen.add(entry["id"])
        apps.append(entry)
    apps.sort(key=lambda item: item["name"].lower())
    return {"apps": apps, "skipped": skipped}


def resolve_by_id(catalog, entry_id) -> dict | None:
    """Find a catalog entry by stable ID. Only issued IDs resolve; names never match."""
    if not isinstance(catalog, list) or not isinstance(entry_id, str) or entry_id == "":
        return None
    for entry in catalog:
        if isinstance(entry, dict) and entry.get("id") == entry_id:
            return entry
    return None


def search_catalog(catalog, query: str = "", limit: int = AUTOCOMPLETE_LIMIT) -> list:
    """Filter catalog by case-insensitive name substring. Empty query returns head."""
    if not isinstance(catalog, list):
        return []
    needle = str(query or "").lower()
    matches = list(catalog) if needle == "" else [e for e in catalog if needle in str(e.get("name", "")).lower()]
    return matches[:limit]


def to_autocomplete_choices(entries: list) -> list:
    """Map entries to choice dicts. Value carries the stable ID."""
    choices = []
    for entry in entries:
        label = str(entry.get("name", ""))
        folder = entry.get("folder") or ""
        if folder not in ("", "."):
            label += f" — {folder}"
        if len(label) > 100:
            label = label[:99] + "…"
        choices.append({"name": label, "value": entry.get("id")})
    return choices


def format_apps_list(matches: list, total: int) -> str:
    """Render catalog matches as reply text, including each entry's launch ID.

    The ID in brackets is what !pc open accepts. Caps lines and appends
    overflow count so huge catalogs stay readable.
    """
    if not matches:
        return "No applications found. Try another search."
    lines = []
    for entry in matches[:LIST_LIMIT]:
        folder = entry.get("folder") or ""
        where = f" ({folder})" if folder not in ("", ".") else ""
        state = "" if entry.get("available") else " [unavailable]"
        lines.append(f"- {entry.get('name')}{where} [{entry.get('id')}]{state}")
    if total > len(matches):
        lines.append(f"…and {total - len(matches)} more. Refine search or pick from !pc open.")
    return "Applications (use !pc open <id> to launch):\n" + "\n".join(lines)


def launch_app(entry: dict, spawn_fn=None) -> str:
    """Launch a catalog entry without shell, detached.

    Re-validates target and stats the file on every call. Throws readable
    errors for unknown IDs, unsafe targets, and missing files.
    """
    if not isinstance(entry, dict):
        raise ValueError("Unknown application. Pick one from the apps list.")
    if entry.get("target") is None or entry.get("unresolved") is True:
        raise ValueError(f"\"{entry.get('name') or 'app'}\" path could not be resolved reliably. Not launching.")
    target = str(entry.get("target") or "").replace("/", "\\")
    if not __import__("re").match(r"^[A-Za-z]:\\", target) or ".." in target or not target.lower().endswith(EXE_EXT):
        raise ValueError(f"Blocked unsafe target for \"{entry.get('name') or 'app'}\".")
    if not Path(target).is_file():
        raise ValueError(f"\"{entry.get('name') or 'app'}\" target missing on this PC.")
    launcher = spawn_fn if spawn_fn is not None else subprocess.Popen
    kwargs = {"shell": False, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0
        )
        kwargs["close_fds"] = False
    else:
        kwargs["start_new_session"] = True
    child = launcher([target], **kwargs)
    try:
        child.pid
    except Exception:
        pass
    return str(entry.get("name"))
