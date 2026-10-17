# Unit tests for the persistent, non-secret installation identity store.
# Covers ID generation/persistence, guild-category memory, tolerant
# loading, and env-based path resolution. No filesystem outside tmp.

import json

from astral_relay.agent import identity
from astral_relay.agent.identity import StateStore, load_state, save_state, state_file


def test_state_file_uses_state_dir(tmp_path):
    env = {"LOCALAPPDATA": str(tmp_path)}
    assert state_file(env) == tmp_path / "AstralRelay" / identity.STATE_FILENAME
    assert state_file({}) is None


def test_installation_id_generated_and_persisted(tmp_path):
    path = tmp_path / "identity.json"
    store = StateStore(path)
    first = store.installation_id
    assert first and len(first) >= 16

    reopened = StateStore(path)
    assert reopened.installation_id == first
    assert json.loads(path.read_text(encoding="utf-8"))["installationId"] == first


def test_installation_id_generated_only_once_per_store(tmp_path):
    path = tmp_path / "identity.json"
    store = StateStore(path)
    assert store.installation_id == store.installation_id


def test_guild_category_memory_round_trip(tmp_path):
    path = tmp_path / "identity.json"
    store = StateStore(path)
    store.remember(12345, 999, "HOST [abcdef]")

    reopened = StateStore(path)
    assert reopened.category_id(12345) == 999
    assert reopened.category_id(99999) is None


def test_info_channel_and_message_memory_round_trip(tmp_path):
    path = tmp_path / "identity.json"
    store = StateStore(path)
    store.remember(12345, 999, "HOST [abcdef]")
    store.remember_info(12345, channel_id=555, message_id=777)

    reopened = StateStore(path)
    assert reopened.category_id(12345) == 999
    assert reopened.info_channel_id(12345) == 555
    assert reopened.info_message_id(12345) == 777
    assert reopened.info_channel_id(99999) is None
    # Remembering the category again must not drop the info IDs.
    reopened.remember(12345, 999, "HOST [abcdef]")
    assert StateStore(path).info_message_id(12345) == 777


def test_report_message_list_round_trips_and_drops_the_legacy_field(tmp_path):
    path = tmp_path / "identity.json"
    store = StateStore(path)
    store.remember(12345, 999, "HOST [abcdef]")
    assert store.info_messages(12345) == []

    store.remember_info_messages(12345, [777, 778, 779])
    reopened = StateStore(path)
    assert reopened.info_messages(12345) == [777, 778, 779]
    # The legacy single-ID field is dropped once a real list is stored.
    record = reopened._record(12345)
    assert "infoMessageId" not in record

    # A shorter report replaces the list rather than appending to it.
    reopened.remember_info_messages(12345, [777])
    assert StateStore(path).info_messages(12345) == [777]
    assert StateStore(path).info_messages(99999) == []


def test_report_message_list_reads_the_legacy_single_id(tmp_path):
    legacy = tmp_path / "legacy.json"
    legacy.write_text(json.dumps({
        "installationId": "abc",
        "guilds": {"1": {"categoryId": 7, "name": "n", "infoChannelId": 5, "infoMessageId": 42}},
    }), encoding="utf-8")
    store = StateStore(legacy)
    # An existing panel from an older build is refreshed in place, not duplicated.
    assert store.info_messages(1) == [42]
    store.remember_info_messages(1, [42, 43])
    assert StateStore(legacy).info_messages(1) == [42, 43]

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text(json.dumps({
        "installationId": "abc",
        "guilds": {"1": {"categoryId": 7, "name": "n", "infoMessages": "not-a-list", "infoMessageId": 42}},
    }), encoding="utf-8")
    # A corrupt list is ignored in favour of the legacy single ID, never a crash.
    assert StateStore(corrupt).info_messages(1) == [42]


def test_load_state_drops_malformed_info_ids(tmp_path):
    malformed = tmp_path / "malformed.json"
    malformed.write_text(json.dumps({
        "installationId": "abc",
        "guilds": {"1": {"categoryId": 7, "name": "n", "infoChannelId": "x", "infoMessageId": 5}},
    }), encoding="utf-8")
    state = load_state(malformed)
    assert state["guilds"]["1"] == {"categoryId": 7, "name": "n", "infoMessageId": 5}


def test_load_state_tolerates_missing_and_corrupt(tmp_path):
    missing = tmp_path / "nope.json"
    assert load_state(missing)["guilds"] == {}

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json", encoding="utf-8")
    assert load_state(corrupt)["installationId"] == ""

    malformed = tmp_path / "malformed.json"
    malformed.write_text(json.dumps({
        "installationId": 5,
        "guilds": {"1": {"categoryId": "x"}, "2": {"categoryId": 7, "name": "ok"}},
    }), encoding="utf-8")
    state = load_state(malformed)
    assert state["installationId"] == ""
    assert state["guilds"] == {"2": {"categoryId": 7, "name": "ok"}}


def test_save_state_is_atomic_and_survives_reload(tmp_path):
    path = tmp_path / "identity.json"
    assert save_state({"installationId": "abc", "guilds": {"1": {"categoryId": 2, "name": "n"}}}, path)
    loaded = load_state(path)
    assert loaded["installationId"] == "abc"
    assert loaded["guilds"]["1"]["categoryId"] == 2
    # The temporary file is gone after a successful replace.
    assert list(tmp_path.glob(".identity.json.tmp-*")) == []


def test_save_state_reports_failure_without_raising(tmp_path):
    # A directory where the file should be makes the write fail cleanly.
    path = tmp_path / "as-dir"
    path.mkdir()
    assert save_state({"installationId": "abc", "guilds": {}}, path) is False
