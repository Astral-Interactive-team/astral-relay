# Components V2 rendering and publication for the managed #info dashboard.
# The collector in windows/inventory.py returns display-ready facts; this
# module is the presentation half: it turns one inventory into ordered
# sections, packs them into as few Discord messages as the platform
# limits allow, and republishes them into the existing per-computer
# #info channel. Nothing here collects data and nothing here decides what
# is available, so the two halves stay independently testable.
# Message limits (4000 display characters and 40 components per message)
# are enforced before every send, and a failing part is logged instead of
# being recorded as published. Each section starts with a Markdown
# heading behind a separator, and a section that outgrows one message
# repeats its heading with a (continued) marker so a reader never loses
# context. No embeds are used: every title, body, and divider is a V2
# component.

from __future__ import annotations

from dataclasses import dataclass

from astral_relay.agent.windows.inventory import NOT_SUPPORTED, UNAVAILABLE
from astral_relay.shared.logging_utils import warn

TITLE = "Astral Relay — System Information"
ACCENT_COLOUR = 0x6C5CE7

# Discord limits: 4000 display characters and 40 components per message.
# The published budgets leave a safety margin so a late change can never
# push a real message over the platform limit.
MAX_TEXT_LENGTH = 4000
MAX_COMPONENTS = 40
TEXT_BUDGET = 3800
COMPONENT_BUDGET = 39

# Longest body text one TextDisplay holds before the section is chunked.
SECTION_CHUNK = 1700


@dataclass(frozen=True)
class Block:
    """One TextDisplay of the report.

    `heading` marks a block that opens a section, so a separator is
    drawn above it when it does not already start a message.
    """

    text: str
    heading: bool = False


# ---------------------------------------------------------------------------
# Section bodies
# ---------------------------------------------------------------------------


def _field(label: str, value) -> str:
    """Render one `**Label:** value` line, defaulting to Unavailable."""
    if value is None or (isinstance(value, str) and not value.strip()):
        value = UNAVAILABLE
    return f"**{label}:** {value}"


def _identity_lines(identity: dict) -> list[str]:
    """Render the PC identification block shown first in the report."""
    return [
        _field("Hostname", identity.get("hostname")),
        _field("Installation ID", identity.get("installationId")),
        _field("Local IPv4", identity.get("localIpv4")),
        _field("Public IPv4", identity.get("publicIpv4")),
        _field("Manufacturer", identity.get("manufacturer")),
        _field("Model", identity.get("model")),
        _field("System type", identity.get("systemType")),
        _field("Operating system", identity.get("osName")),
        _field("OS version / build", identity.get("osVersion")),
        _field("Agent status", identity.get("agentStatus")),
        _field("Agent version", identity.get("agentVersion")),
        _field("System boot time", identity.get("bootTime")),
        _field("System uptime", identity.get("uptime")),
        _field("Last updated", identity.get("lastUpdated")),
    ]


def _os_lines(os_info: dict) -> list[str]:
    """Render the Windows and operating system section."""
    return [
        _field("OS name", os_info.get("osName")),
        _field("OS manufacturer", os_info.get("osManufacturer")),
        _field("OS version", os_info.get("osVersion")),
        _field("OS build number", os_info.get("osBuild")),
        _field("Feature update", os_info.get("osDisplayVersion")),
        _field("Edition", os_info.get("osEdition")),
        _field("Architecture", os_info.get("osArchitecture")),
        _field("OS configuration", os_info.get("osConfiguration")),
        _field("OS build type", os_info.get("osBuildType")),
        _field("Registered owner", os_info.get("registeredOwner")),
        _field("Registered organization", os_info.get("registeredOrganization")),
        _field("Windows product ID", os_info.get("productId")),
        _field("Original install date", os_info.get("originalInstallDate")),
        _field("System boot time", os_info.get("bootTime")),
        _field("System uptime", os_info.get("uptime")),
        _field("System locale", os_info.get("systemLocale")),
        _field("Input locale", os_info.get("inputLocale")),
        _field("Time zone", os_info.get("timeZone")),
        _field("Domain / workgroup", os_info.get("domainWorkgroup")),
        _field("Domain joined", os_info.get("partOfDomain")),
        _field("Windows directory", os_info.get("windowsDirectory")),
        _field("System directory", os_info.get("systemDirectory")),
        _field("Boot device", os_info.get("bootDevice")),
        _field("Firmware architecture", os_info.get("firmwareArchitecture")),
    ]


def _cpu_lines(cpu: dict) -> list[str]:
    """Render the processor section."""
    return [
        _field("Processor manufacturer", cpu.get("manufacturer")),
        _field("Processor model", cpu.get("model")),
        _field("Identifier", cpu.get("identifier")),
        _field("Architecture", cpu.get("architecture")),
        _field("Physical cores", cpu.get("physicalCores")),
        _field("Logical processors", cpu.get("logicalProcessors")),
        _field("Maximum clock speed", cpu.get("maxClock")),
        _field("Current clock speed", cpu.get("currentClock")),
        _field("L2 cache", cpu.get("l2Cache")),
        _field("L3 cache", cpu.get("l3Cache")),
        _field("Virtualization support (firmware)", cpu.get("virtualizationFirmware")),
        _field("Virtualization extensions (SLAT)", cpu.get("virtualizationExtensions")),
        _field("Hypervisor present", cpu.get("hypervisorPresent")),
        _field("CPU utilization (sampled)", cpu.get("utilization")),
        _field("CPU temperature", cpu.get("temperature")),
    ]


def _memory_lines(memory: dict) -> list[str]:
    """Render the physical and virtual memory section with module details."""
    lines = [
        _field("Total physical memory", memory.get("totalPhysical")),
        _field("Used memory", memory.get("usedPhysical")),
        _field("Available memory", memory.get("availablePhysical")),
        _field("Memory usage", memory.get("usagePercent")),
        _field("Total virtual memory (commit limit)", memory.get("totalVirtual")),
        _field("Available virtual memory", memory.get("availableVirtual")),
        _field("Page file size", memory.get("pageFileSize")),
        _field("Page file usage", memory.get("pageFileUsage")),
        _field("Installed module count", memory.get("moduleCount")),
    ]
    modules = memory.get("modules") or []
    if not modules:
        return lines + [_field("Memory modules", NOT_SUPPORTED)]
    lines.append("")
    lines.append("**Memory modules**")
    for module in modules:
        lines.append(
            f"- {module.get('locator')} | {module.get('capacity')} | {module.get('type')} | "
            f"{module.get('speed')} | {module.get('manufacturer')} | {module.get('partNumber')}"
        )
    return lines


def _graphics_lines(graphics: list) -> list[str]:
    """Render one block per graphics adapter, including display output."""
    if not graphics:
        return [_field("Graphics adapters", UNAVAILABLE)]
    lines: list[str] = []
    for index, gpu in enumerate(graphics, start=1):
        if index > 1:
            lines.append("")
        lines.extend([
            f"**GPU {index}: {_plain(gpu.get('name'))}**",
            _field("Manufacturer", gpu.get("manufacturer")),
            _field("Driver version", gpu.get("driverVersion")),
            _field("Driver date", gpu.get("driverDate")),
            _field("Dedicated memory (reported)", gpu.get("dedicatedMemory")),
            _field("Shared memory", gpu.get("sharedMemory")),
            _field("Utilization", gpu.get("utilization")),
            _field("Temperature", gpu.get("temperature")),
            _field("Resolution", gpu.get("resolution")),
            _field("Refresh rate", gpu.get("refreshRate")),
            _field("HDR", gpu.get("hdr")),
            _field("Status", gpu.get("status")),
        ])
    lines.append(_field("Detected adapters", str(len(graphics))))
    return lines


def _board_lines(board: dict) -> list[str]:
    """Render the motherboard and firmware section."""
    return [
        _field("Motherboard manufacturer", board.get("boardManufacturer")),
        _field("Motherboard model", board.get("boardModel")),
        _field("Motherboard version", board.get("boardVersion")),
        _field("BIOS manufacturer", board.get("biosManufacturer")),
        _field("BIOS version", board.get("biosVersion")),
        _field("BIOS release date", board.get("biosReleaseDate")),
        _field("Firmware mode", board.get("biosMode")),
        _field("Secure Boot", board.get("secureBoot")),
        _field("TPM available", board.get("tpmPresent")),
        _field("TPM version", board.get("tpmVersion")),
        _field("TPM firmware", board.get("tpmManufacturerVersion")),
    ]


def _storage_lines(storage: dict) -> list[str]:
    """Render logical volumes, physical drives, health, and BitLocker state."""
    lines = ["**Logical volumes**"]
    logical = storage.get("logical") or []
    if not logical:
        lines.append(_field("Volumes", UNAVAILABLE))
    for drive in logical:
        lines.append(
            f"- {drive.get('device')} | {drive.get('type')} | {drive.get('fileSystem')} | "
            f"{drive.get('total')} total | {drive.get('used')} used | {drive.get('free')} free | "
            f"{drive.get('usedPercent')} used"
        )
    lines.append("")
    lines.append("**Physical drives**")
    physical = storage.get("physical") or []
    if not physical:
        lines.append(_field("Disks", UNAVAILABLE))
    for disk in physical:
        lines.append(
            f"- {disk.get('model')} | {disk.get('mediaType')} | {disk.get('busType')} | "
            f"{disk.get('size')} | health {disk.get('health')} | state {disk.get('operational')} | "
            f"temp {disk.get('temperature')} | wear {disk.get('wear')}"
        )
    lines.append("")
    lines.append("**BitLocker volumes**")
    bitlocker = storage.get("bitlocker") or []
    if not bitlocker:
        lines.append(_field("Volumes", UNAVAILABLE))
    for volume in bitlocker:
        lines.append(
            f"- {volume.get('mountPoint')} | protection {volume.get('protection')} | "
            f"{volume.get('status')} | {volume.get('encryption')} | {volume.get('percent')}"
        )
    return lines


def _network_lines(network: dict) -> list[str]:
    """Render every network adapter plus the connection summary."""
    lines = [
        _field("Internet connectivity", network.get("internetConnectivity")),
        _field("Public IPv4", network.get("publicIpv4")),
        _field("Discord gateway connection", network.get("discordConnection")),
        _field("Discord gateway latency", network.get("discordLatency")),
        "",
    ]
    adapters = network.get("adapters") or []
    if not adapters:
        lines.append(_field("Network adapters", UNAVAILABLE))
        return lines
    lines.append(f"**Network adapters ({len(adapters)})**")
    for adapter in adapters:
        lines.append(
            f"- {adapter.get('name')} | {adapter.get('description')} | {adapter.get('status')} | "
            f"virtual {adapter.get('virtual')}"
        )
        lines.append(
            f"  IPv4 {adapter.get('ipv4')} | IPv6 {adapter.get('ipv6')} | mask {adapter.get('subnet')} | "
            f"gateway {adapter.get('gateway')} | DNS {adapter.get('dns')}"
        )
        lines.append(
            f"  DHCP {adapter.get('dhcpEnabled')} | server {adapter.get('dhcpServer')} | "
            f"MAC {adapter.get('mac')} | link {adapter.get('linkSpeed')} | "
            f"rx {adapter.get('received')} | tx {adapter.get('sent')}"
        )
    return lines


def _power_lines(power: dict) -> list[str]:
    """Render power source, battery, and the active power plan."""
    return [
        _field("Power source", power.get("powerSource")),
        _field("Battery present", power.get("batteryPresent")),
        _field("Battery level", power.get("batteryLevel")),
        _field("Charging status", power.get("charging")),
        _field("Active power plan", power.get("powerPlan")),
        _field("Sleep / hibernate settings", power.get("sleepStates")),
    ]


def _security_lines(security: dict) -> list[str]:
    """Render Defender, firewall, update, and platform-security state."""
    return [
        _field("Windows Defender", security.get("defenderStatus")),
        _field("Real-time protection", security.get("realTimeProtection")),
        _field("Defender signature", security.get("defenderSignature")),
        _field("Signature updated", security.get("defenderSignatureDate")),
        _field("Windows Firewall", security.get("firewallStatus")),
        _field("Last installed update", security.get("lastUpdate")),
        _field("Installed hotfix count", security.get("hotfixCount")),
        _field("Pending updates", security.get("pendingUpdates")),
        _field("UAC", security.get("uacStatus")),
        _field("Secure Boot", security.get("secureBoot")),
        _field("TPM", security.get("tpmStatus")),
        _field("BitLocker", security.get("bitlockerStatus")),
    ]


def _software_lines(software: dict) -> list[str]:
    """Render the inventory counts and the complete application list."""
    lines = [
        _field("Installed application count", software.get("count")),
        _field("Start Menu applications", software.get("startMenuCount")),
        _field("Launchable Start Menu entries", software.get("startMenuAvailable")),
        _field("Default browser", software.get("defaultBrowser")),
        _field("Inventory collection", software.get("status")),
        "",
    ]
    items = software.get("items") or []
    if not items:
        lines.append(_field("Applications", UNAVAILABLE))
        return lines
    lines.append(f"**Applications ({len(items)})**")
    for item in items:
        lines.append(f"- {item.get('name')} | {item.get('version')} | {item.get('publisher')}")
    return lines


def _process_lines(processes: dict, services: dict) -> list[str]:
    """Render process counts, top consumers, the full process list, and services."""
    lines = [
        _field("Running processes", str(processes.get("count", UNAVAILABLE))),
        _field("Services (total)", str(services.get("total", UNAVAILABLE))),
        _field("Services (running)", str(services.get("running", UNAVAILABLE))),
        _field("Services (stopped)", str(services.get("stopped", UNAVAILABLE))),
        "",
        "**Top CPU processes (CPU time since start)**",
    ]
    top_cpu = processes.get("topCpu") or []
    if not top_cpu:
        lines.append(_field("Processes", UNAVAILABLE))
    for item in top_cpu:
        lines.append(f"- {item.get('name')} ({item.get('pid')}) | {item.get('value')}")
    lines.append("")
    lines.append("**Top memory processes (working set)**")
    top_memory = processes.get("topMemory") or []
    if not top_memory:
        lines.append(_field("Processes", UNAVAILABLE))
    for item in top_memory:
        lines.append(f"- {item.get('name')} ({item.get('pid')}) | {item.get('value')}")
    lines.append("")
    lines.append("**Running processes (name, PID)**")
    items = processes.get("items") or []
    if not items:
        lines.append(_field("Processes", UNAVAILABLE))
    for item in items:
        lines.append(f"- {item.get('name')} ({item.get('pid')})")
    lines.append("")
    lines.append("**Services (name | display name | state | start type)**")
    service_items = services.get("items") or []
    if not service_items:
        lines.append(_field("Services", UNAVAILABLE))
    for service in service_items:
        lines.append(
            f"- {service.get('name')} | {service.get('display')} | "
            f"{service.get('status')} | {service.get('startType')}"
        )
    return lines


def _performance_lines(performance: dict) -> list[str]:
    """Render sampled utilization counters and the sampling window."""
    return [
        _field("CPU utilization", performance.get("cpuUtilization")),
        _field("Memory utilization", performance.get("memoryUtilization")),
        _field("Disk read throughput", performance.get("diskRead")),
        _field("Disk write throughput", performance.get("diskWrite")),
        _field("Disk busy time", performance.get("diskBusy")),
        _field("Network received", performance.get("networkReceived")),
        _field("Network sent", performance.get("networkSent")),
        _field("Sampling window", performance.get("sampleWindow")),
        _field("Sample timestamp", performance.get("sampleTimestamp")),
    ]


def _environment_lines(environment: dict) -> list[str]:
    """Render directory and environment availability facts."""
    return [
        _field("Windows directory", environment.get("windowsDirectory")),
        _field("System directory", environment.get("systemDirectory")),
        _field("Boot device", environment.get("bootDevice")),
        _field("Firmware architecture", environment.get("firmwareArchitecture")),
        _field("Environment collection", environment.get("environmentStatus")),
        _field("Agent state directory", environment.get("stateDirectory")),
        _field("Diagnostic log", environment.get("diagnosticLog")),
        _field("Software inventory", environment.get("softwareStatus")),
    ]


def _agent_lines(agent: dict) -> list[str]:
    """Render the Astral Relay agent section."""
    return [
        _field("Agent version", agent.get("version")),
        _field("Installation ID", agent.get("installationId")),
        _field("Agent uptime", agent.get("uptime")),
        _field("Process ID", agent.get("pid")),
        _field("Discord connection", agent.get("connection")),
        _field("Discord latency", agent.get("latency")),
        _field("Reconnect count", agent.get("reconnectCount")),
        _field("Last successful update", agent.get("lastUpdate")),
        _field("Enabled prefix commands", agent.get("commands")),
        _field("Required management permission", agent.get("permission")),
        _field("Managed category status", agent.get("categoryStatus")),
        _field("Managed channel count", agent.get("channelCount")),
        _field("Duplicate category warning", agent.get("duplicateWarning")),
        _field("Startup registration", agent.get("startupRegistration")),
        _field("Backup executable", agent.get("backupExecutable")),
        _field("Diagnostic summary", agent.get("logSummary")),
    ]


def _plain(value) -> str:
    """Render a value inside a bold heading without nesting markdown."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return UNAVAILABLE
    return str(value)


# ---------------------------------------------------------------------------
# Blocks and message packing
# ---------------------------------------------------------------------------


def sections(inventory: dict) -> list[tuple[str, list[str]]]:
    """Return the report sections in fixed display order."""
    return [
        ("Device Identity", _identity_lines(inventory.get("identity") or {})),
        ("Windows & Operating System", _os_lines(inventory.get("os") or {})),
        ("Processor", _cpu_lines(inventory.get("cpu") or {})),
        ("Memory", _memory_lines(inventory.get("memory") or {})),
        ("Graphics & Displays", _graphics_lines(inventory.get("graphics") or [])),
        ("Motherboard & Firmware", _board_lines(inventory.get("board") or {})),
        ("Storage", _storage_lines(inventory.get("storage") or {})),
        ("Network", _network_lines(inventory.get("network") or {})),
        ("Power & Battery", _power_lines(inventory.get("power") or {})),
        ("Security & Updates", _security_lines(inventory.get("security") or {})),
        ("Installed Software", _software_lines(inventory.get("software") or {})),
        (
            "Processes & Services",
            _process_lines(inventory.get("processes") or {}, inventory.get("services") or {}),
        ),
        ("Performance", _performance_lines(inventory.get("performance") or {})),
        ("System Directories & Environment", _environment_lines(inventory.get("environment") or {})),
        ("Astral Relay Agent", _agent_lines(inventory.get("agent") or {})),
    ]


def header_block(inventory: dict) -> Block:
    """Build the report title block shown at the top of the first message."""
    identity = inventory.get("identity") or {}
    return Block(
        text="\n".join([
            f"# {TITLE}",
            _field("Status", identity.get("agentStatus")),
            _field("Host", f"{_plain(identity.get('hostname'))} ({_plain(identity.get('installationId'))})"),
            _field("Agent", f"v{_plain(identity.get('agentVersion'))}"),
            _field("Updated", identity.get("lastUpdated")),
        ]),
    )


def build_blocks(inventory: dict) -> list[Block]:
    """Turn one collected inventory into ordered, size-limited blocks."""
    blocks = [header_block(inventory)]
    for title, lines in sections(inventory):
        blocks.extend(_section_blocks(title, lines))
    return blocks


def _flatten(lines: list[str]) -> list[str]:
    """Hard-wrap any single line that alone would exceed one block."""
    result: list[str] = []
    for line in lines:
        while len(line) > SECTION_CHUNK:
            result.append(line[:SECTION_CHUNK])
            line = line[SECTION_CHUNK:]
        result.append(line)
    return result


def _body_block(title: str, lines: list[str], first: bool) -> Block:
    """Build one section body, repeating the heading on continuations."""
    heading = f"## {title}" if first else f"## {title} (continued)"
    return Block(text=heading + "\n" + "\n".join(lines), heading=True)


def _section_blocks(title: str, lines: list[str]) -> list[Block]:
    """Split one section into body blocks that stay under one message budget."""
    if not lines:
        return []
    blocks: list[Block] = []
    chunk: list[str] = []
    length = 0
    first = True
    for line in _flatten(lines):
        cost = len(line) + 1
        if chunk and length + cost > SECTION_CHUNK:
            blocks.append(_body_block(title, chunk, first))
            first = False
            chunk = []
            length = 0
        chunk.append(line)
        length += cost
    if chunk:
        blocks.append(_body_block(title, chunk, first))
    return blocks


def pack_blocks(blocks: list[Block]) -> list[list[Block]]:
    """Pack blocks into pages that respect every Discord message limit.

    Blocks are never reordered, split, or dropped, so the published
    report always contains every item exactly once and in order.
    """
    pages: list[list[Block]] = []
    page: list[Block] = []
    length = 0
    children = 0
    for block in blocks:
        cost = len(block.text)
        added = 1 + (1 if (page and block.heading) else 0)
        if page and (length + cost > TEXT_BUDGET or children + added > COMPONENT_BUDGET - 1):
            pages.append(page)
            page = []
            length = 0
            children = 0
            added = 1
        page.append(block)
        length += cost
        children += added
    if page:
        pages.append(page)
    return pages


def build_report(inventory: dict) -> tuple[list[Block], list[list[Block]]]:
    """Build the ordered blocks and the packed message pages for one inventory."""
    blocks = build_blocks(inventory)
    return blocks, pack_blocks(blocks)


def build_views(pages: list[list[Block]]) -> list:
    """Build one Components V2 LayoutView per packed page, in order."""
    import discord
    from discord import ui

    views = []
    for page in pages:
        children = []
        for index, block in enumerate(page):
            if index and block.heading:
                children.append(ui.Separator(spacing=discord.SeparatorSpacing.small))
            children.append(ui.TextDisplay(block.text))
        view = ui.LayoutView(timeout=None)
        view.add_item(ui.Container(*children, accent_colour=discord.Colour(ACCENT_COLOUR)))
        views.append(view)
    return views


def measure_view(view) -> dict:
    """Measure one LayoutView against the Discord message limits."""
    text_length = view.content_length()
    components = view.total_children_count
    return {
        "textLength": text_length,
        "components": components,
        "textOk": text_length <= MAX_TEXT_LENGTH,
        "componentsOk": components <= MAX_COMPONENTS,
    }


def validate_views(views: list) -> list[dict]:
    """Measure every view that is about to be sent, warning on overruns.

    The report builder already sizes pages to the budgets, so a violation
    here means a bug: it is reported instead of being sent silently.
    """
    reports = []
    for index, view in enumerate(views):
        report = measure_view(view)
        report["index"] = index
        if not (report["textOk"] and report["componentsOk"]):
            warn(
                "Info report part exceeds Discord limits.",
                {"part": index, "text": report["textLength"], "components": report["components"]},
            )
        reports.append(report)
    return reports


# ---------------------------------------------------------------------------
# Publication
# ---------------------------------------------------------------------------


def _owned_by_client(message, channel) -> bool:
    """True only when this bot account authored the message."""
    author = getattr(message, "author", None)
    me = getattr(getattr(channel, "guild", None), "me", None)
    if author is not None and me is not None:
        return getattr(author, "id", None) == getattr(me, "id", None)
    return bool(getattr(author, "bot", False))


async def _fetch_owned(channel, message_id):
    """Fetch a tracked message, or None when it is gone or not ours."""
    fetch = getattr(channel, "fetch_message", None)
    if not callable(fetch):
        return None
    try:
        message = await fetch(message_id)
    except Exception:  # noqa: BLE001 - a deleted message simply cannot be reused
        return None
    return message if _owned_by_client(message, channel) else None


async def _edit_view(message, view) -> bool:
    """Replace a tracked message's content with the new view."""
    edit = getattr(message, "edit", None)
    if not callable(edit):
        return False
    try:
        # The old report used message content; clearing it is required
        # before the same message can carry Components V2.
        await edit(content=None, view=view)
        return True
    except Exception as err:  # noqa: BLE001 - fall back to sending a fresh message
        warn("Info report message could not be updated.", {"message": str(err)})
        return False


async def _delete_tracked(channel, message_ids) -> list[int]:
    """Delete tracked bot messages, best-effort. Returns the deleted IDs."""
    removed = []
    for message_id in message_ids:
        message = await _fetch_owned(channel, message_id)
        if message is None:
            continue
        delete = getattr(message, "delete", None)
        if not callable(delete):
            continue
        try:
            await delete()
            removed.append(message_id)
        except Exception as err:  # noqa: BLE001 - cleanup never aborts publication
            warn("Stale info report message could not be removed.", {"message": str(err)})
    return removed


async def _send_views(channel, views: list, start: int) -> tuple[list[int], int | None]:
    """Send views from `start` in order. Returns (message IDs, failed index)."""
    sent: list[int] = []
    for index in range(start, len(views)):
        try:
            message = await channel.send(view=views[index])
        except Exception as err:  # noqa: BLE001 - a failed part is reported, not hidden
            warn(
                "Info report part failed to send.",
                {"part": index, "total": len(views), "message": str(err)},
            )
            return sent, index
        message_id = getattr(message, "id", None)
        if isinstance(message_id, int):
            sent.append(message_id)
    return sent, None


def _tracked_ids(store, guild_id) -> list[int]:
    """Read the tracked report message IDs, tolerating a missing store."""
    reader = getattr(store, "info_messages", None)
    if not callable(reader):
        return []
    try:
        tracked = reader(guild_id)
    except Exception:  # noqa: BLE001 - unreadable state means publish fresh
        return []
    return [item for item in (tracked or []) if isinstance(item, int) and not isinstance(item, bool)]


def _remember(store, guild_id, message_ids) -> None:
    """Persist the published message IDs so a restart can refresh them."""
    remember = getattr(store, "remember_info_messages", None)
    if not callable(remember):
        return
    try:
        remember(guild_id, message_ids)
    except Exception as err:  # noqa: BLE001 - losing the IDs only costs a repost
        warn("Info report tracking could not be saved.", {"message": str(err)})


async def publish_report(channel, views: list, store, guild_id) -> dict:
    """Publish the report views into one channel, in order.

    Messages tracked from a previous run are reused in place, so a
    restart refreshes the report instead of duplicating it. When a
    tracked message is gone, or the report needs more messages than
    before, the remaining tracked messages are removed first so the fresh
    sends stay in sequence. Only messages authored by this bot are ever
    edited or deleted, and a failed part stops the run so a later part
    can never appear before a missing one.
    """
    validate_views(views)
    tracked = _tracked_ids(store, guild_id)
    published: list[int] = []
    deleted: list[int] = []
    reused = 0
    for index, view in enumerate(views):
        if index < len(tracked):
            message = await _fetch_owned(channel, tracked[index])
            if message is not None and await _edit_view(message, view):
                published.append(tracked[index])
                reused += 1
                continue
        deleted.extend(await _delete_tracked(channel, tracked[index:]))
        sent, failed_at = await _send_views(channel, views, index)
        published.extend(sent)
        _remember(store, guild_id, published)
        if failed_at is not None:
            warn(
                "Info report published partially.",
                {"guild": guild_id, "failedPart": failed_at, "total": len(views)},
            )
        return {"published": published, "failedAt": failed_at, "deleted": deleted, "reused": reused}
    deleted.extend(await _delete_tracked(channel, tracked[len(views):]))
    _remember(store, guild_id, published)
    return {"published": published, "failedAt": None, "deleted": deleted, "reused": reused}
