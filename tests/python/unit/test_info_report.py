# Unit tests for the Components V2 #info dashboard renderer and publisher.
# The renderer is pure, so these tests check the real packing arithmetic and
# the real discord.py LayoutView objects; the publisher runs against fake
# channels and a fake state store, with no network.

import asyncio
from types import SimpleNamespace

import pytest

from astral_relay.agent import info_report
from astral_relay.agent.info_report import Block, publish_report

BOT = SimpleNamespace(id=7, bot=True)
FOREIGN = SimpleNamespace(id=8, bot=False)


def sample(**sections):
    """Build a minimal inventory with the identity block every report needs."""
    inventory = {
        "identity": {
            "hostname": "DESKTOP-TEST",
            "installationId": "abc123",
            "agentStatus": "ONLINE",
            "agentVersion": "0.1.0",
            "lastUpdated": "2026-01-01 01:00:00",
        },
    }
    inventory.update(sections)
    return inventory


def big_inventory(items=400):
    """Build an inventory whose software list spans several messages."""
    return sample(software={
        "count": str(items),
        "items": [
            {"name": f"Application {index:04d}", "version": "1.0", "publisher": "Vendor"}
            for index in range(items)
        ],
        "status": "Collected",
    })


def make_views(count):
    """Build `count` real LayoutViews for publisher tests."""
    return info_report.build_views([[Block(f"body {index}")] for index in range(count)])


# ---------------------------------------------------------------------------
# Layout
# ---------------------------------------------------------------------------


def test_report_has_the_documented_section_order():
    titles = [title for title, _ in info_report.sections(sample())]
    assert titles == [
        "Device Identity",
        "Windows & Operating System",
        "Processor",
        "Memory",
        "Graphics & Displays",
        "Motherboard & Firmware",
        "Storage",
        "Network",
        "Power & Battery",
        "Security & Updates",
        "Installed Software",
        "Processes & Services",
        "Performance",
        "System Directories & Environment",
        "Astral Relay Agent",
    ]


def test_header_leads_the_report_with_status_and_identification():
    blocks = info_report.build_blocks(sample())
    header = blocks[0]
    assert header.heading is False
    assert header.text.startswith(f"# {info_report.TITLE}")
    assert "**Status:** ONLINE" in header.text
    assert "**Host:** DESKTOP-TEST (abc123)" in header.text
    assert "**Agent:** v0.1.0" in header.text
    assert "**Updated:** 2026-01-01 01:00:00" in header.text


def test_identity_section_comes_before_everything_except_the_header():
    combined = "\n".join(block.text for block in info_report.build_blocks(sample()))
    assert combined.index("## Device Identity") < combined.index("## Windows & Operating System")


def test_unknown_values_render_as_unavailable_not_placeholders():
    text = "\n".join(block.text for block in info_report.build_blocks(sample()))
    # Missing inputs become the explicit marker; no sample values are invented.
    assert "**Graphics adapters:** Unavailable" in text
    # A machine with no reported modules is "Not supported", not "0 modules".
    assert "**Memory modules:** Not supported" in text
    assert "**Pending updates:** Unavailable" in text
    assert "**Public IPv4:** Unavailable" in text
    assert "- " not in text.split("## Installed Software")[1]  # no invented rows either
    # A value the collector marked unsupported is passed through unchanged.
    support_text = "\n".join(block.text for block in info_report.build_blocks(
        sample(security={"pendingUpdates": "Not supported"})
    ))
    assert "**Pending updates:** Not supported" in support_text


def test_long_section_repeats_its_heading_when_continued():
    blocks = info_report.build_blocks(big_inventory())
    software = [block for block in blocks if "## Installed Software" in block.text]
    assert len(software) > 1
    assert software[0].text.startswith("## Installed Software\n")
    assert all(block.text.startswith("## Installed Software (continued)") for block in software[1:])
    assert all(block.heading for block in software)


def test_splitting_preserves_every_item_exactly_once_and_in_order():
    inventory = big_inventory(items=400)
    blocks, pages = info_report.build_report(inventory)
    assert [block.text for page in pages for block in page] == [block.text for block in blocks]
    combined = "\n".join(block.text for block in blocks)
    for index in (0, 199, 399):
        assert combined.count(f"- Application {index:04d} | 1.0 | Vendor") == 1


def test_oversized_single_line_is_wrapped_without_losing_characters():
    giant = "y" * (info_report.SECTION_CHUNK * 2 + 5)
    blocks = info_report._section_blocks("Huge", [giant])
    assert all(len(block.text) <= info_report.MAX_TEXT_LENGTH for block in blocks)
    assert "".join(block.text.replace("## Huge\n", "").replace("## Huge (continued)\n", "") for block in blocks) == giant


def test_packed_pages_stay_inside_both_discord_limits():
    _, pages = info_report.build_report(big_inventory(items=1200))
    assert len(pages) > 3
    views = info_report.build_views(pages)
    reports = info_report.validate_views(views)
    assert all(report["textOk"] for report in reports)
    assert all(report["componentsOk"] for report in reports)
    assert all(report["textLength"] <= info_report.MAX_TEXT_LENGTH for report in reports)
    assert all(report["components"] <= info_report.MAX_COMPONENTS for report in reports)
    assert all(len(page) > 0 for page in pages)


def test_build_views_uses_only_components_v2_containers():
    views = info_report.build_views([[Block("# Title"), Block("## Section", heading=True)]])
    assert len(views) == 1
    components = views[0].to_components()
    assert len(components) == 1
    container = components[0]
    assert container["type"] == 17  # Container
    types = [child["type"] for child in container["components"]]
    assert types == [10, 14, 10]  # TextDisplay, Separator, TextDisplay
    assert all("content" not in child or child["type"] == 10 for child in container["components"])


def test_no_page_starts_with_a_separator():
    _, pages = info_report.build_report(big_inventory(items=400))
    assert all(page for page in pages)
    views = info_report.build_views(pages)
    for view in views:
        container = view.to_components()[0]
        assert container["components"][0]["type"] == 10


def test_validate_views_reports_an_oversized_part(monkeypatch):
    warnings = []
    monkeypatch.setattr(info_report, "warn", lambda message, detail=None: warnings.append(message))
    view = info_report.build_views([[Block("x" * (info_report.MAX_TEXT_LENGTH + 1))]])[0]
    reports = info_report.validate_views([view])
    assert reports[0]["textOk"] is False
    assert warnings and "exceeds Discord limits" in warnings[0]


# ---------------------------------------------------------------------------
# Publication
# ---------------------------------------------------------------------------


class FakeMessage:
    def __init__(self, message_id, author=BOT):
        self.id = message_id
        self.author = author
        self.views = []
        self.deleted = False

    async def edit(self, content=None, view=None, **kwargs):
        assert content is None, "a Components V2 message must not carry content"
        self.views.append(view)
        return self

    async def delete(self):
        self.deleted = True


class FakeChannel:
    def __init__(self, messages=None, fail_at=None):
        self.guild = SimpleNamespace(me=BOT)
        self.messages = {message.id: message for message in (messages or [])}
        self.sent = []
        self.fail_at = fail_at
        self._next_id = 100

    async def send(self, content=None, view=None, **kwargs):
        assert content is None, "a Components V2 message must not carry content"
        if self.fail_at is not None and len(self.sent) == self.fail_at:
            raise RuntimeError("HTTP 500")
        self._next_id += 1
        message = FakeMessage(self._next_id)
        message.views.append(view)
        self.messages[message.id] = message
        self.sent.append(message)
        return message

    async def fetch_message(self, message_id):
        if message_id not in self.messages:
            raise LookupError("unknown message")
        return self.messages[message_id]


class FakeStore:
    def __init__(self, ids=None, broken=False):
        self.ids = list(ids or [])
        self.broken = broken
        self.writes = []

    def info_messages(self, guild_id):
        if self.broken:
            raise RuntimeError("unreadable state")
        return list(self.ids)

    def remember_info_messages(self, guild_id, message_ids):
        self.ids = list(message_ids)
        self.writes.append(list(message_ids))


def test_publisher_refreshes_tracked_messages_in_place():
    tracked = [FakeMessage(1), FakeMessage(2)]
    channel = FakeChannel(tracked)
    store = FakeStore([1, 2])
    views = make_views(2)

    result = asyncio.run(publish_report(channel, views, store, 5))

    assert result == {"published": [1, 2], "failedAt": None, "deleted": [], "reused": 2}
    assert [message.views for message in tracked] == [[views[0]], [views[1]]]
    assert channel.sent == []
    assert store.ids == [1, 2]


def test_publisher_reposts_a_deleted_message_and_clears_the_rest():
    stale = [FakeMessage(1), FakeMessage(2)]
    channel = FakeChannel(stale)
    channel.messages.pop(1)  # operator deleted the first part
    store = FakeStore([1, 2])

    result = asyncio.run(publish_report(channel, make_views(2), store, 5))

    assert result["failedAt"] is None
    assert result["reused"] == 0
    assert result["deleted"] == [2]
    assert stale[1].deleted is True
    assert len(channel.sent) == 2
    assert store.ids == result["published"]


def test_publisher_removes_surplus_messages_when_the_report_shrinks():
    tracked = [FakeMessage(1), FakeMessage(2), FakeMessage(3)]
    channel = FakeChannel(tracked)
    store = FakeStore([1, 2, 3])

    result = asyncio.run(publish_report(channel, make_views(2), store, 5))

    assert result["deleted"] == [3]
    assert tracked[2].deleted is True
    assert store.ids == [1, 2]


def test_publisher_stops_at_a_failed_part_and_records_only_sent_parts(monkeypatch):
    warnings = []
    monkeypatch.setattr(info_report, "warn", lambda message, detail=None: warnings.append(message))
    channel = FakeChannel(fail_at=1)
    store = FakeStore([])

    result = asyncio.run(publish_report(channel, make_views(3), store, 5))

    assert result["failedAt"] == 1
    assert len(result["published"]) == 1
    assert store.ids == result["published"]
    assert len(channel.sent) == 1
    assert warnings and "failed to send" in warnings[0]


def test_publisher_never_edits_or_deletes_foreign_messages():
    foreign = FakeMessage(9, author=FOREIGN)
    channel = FakeChannel([foreign])
    store = FakeStore([9])

    result = asyncio.run(publish_report(channel, make_views(1), store, 5))

    assert foreign.views == []
    assert foreign.deleted is False
    assert result["deleted"] == []
    assert len(channel.sent) == 1


def test_publisher_publishes_fresh_when_tracking_is_unreadable():
    channel = FakeChannel()
    store = FakeStore([1], broken=True)

    result = asyncio.run(publish_report(channel, make_views(2), store, 5))

    assert result["reused"] == 0
    assert len(result["published"]) == 2
    assert len(channel.sent) == 2
    assert store.writes[-1] == result["published"]


def test_publisher_survives_a_channel_without_fetch_support():
    class SendOnlyChannel(FakeChannel):
        fetch_message = None

    channel = SendOnlyChannel()
    store = FakeStore([1, 2])

    result = asyncio.run(publish_report(channel, make_views(1), store, 5))

    assert result["reused"] == 0
    assert len(channel.sent) == 1
    assert store.ids == result["published"]


def test_report_is_never_an_embed():
    views = info_report.build_views(info_report.pack_blocks(info_report.build_blocks(big_inventory(20))))
    for view in views:
        components = view.to_components()
        assert len(components) == 1
        assert components[0]["type"] == 17
        assert all(child["type"] in (10, 14) for child in components[0]["components"])
        assert "embed" not in str(components).lower()


@pytest.mark.parametrize("items", [0, 1, 40, 400])
def test_packing_is_never_empty_for_a_valid_inventory(items):
    blocks, pages = info_report.build_report(big_inventory(items=items))
    assert blocks and pages
    assert sum(len(page) for page in pages) == len(blocks)
