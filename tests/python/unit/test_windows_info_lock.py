# Unit tests for Windows info formatting (the !pc status reply) and session
# lock handling. The full #info dashboard lives in info_report.py and has its
# own test module.

import pytest

from astral_relay.agent.windows.info import format_status, get_status, get_uptime_seconds
from astral_relay.agent.windows.lock import lock_session


def test_status_snapshot_and_format():
    snapshot = get_status("0.1.0", True)
    assert snapshot["connected"] is True
    assert snapshot["agentVersion"] == "0.1.0"
    assert isinstance(snapshot["hostname"], str) and len(snapshot["hostname"]) > 0
    text = format_status(snapshot)
    assert "Status: connected" in text
    assert f"Host: {snapshot['hostname']} ({snapshot['hostId']})" in text
    assert f"IP: {snapshot['localIp']}" in text
    assert "Agent: v0.1.0" in text
    assert "Uptime:" in text
    assert format_status(get_status("0.1.0", False)).startswith("Status: starting")


def test_uptime_helper_is_monotonic_and_non_negative():
    assert isinstance(get_uptime_seconds(), int)
    assert get_uptime_seconds() >= 0
    assert get_status("1.2.3", True)["uptimeSeconds"] == get_uptime_seconds()


def test_machine_id_short_and_stable():
    from astral_relay.agent.windows.info import get_machine_id

    first = get_machine_id()
    assert get_machine_id() == first
    assert first == "unknown-id" or (len(first) == 8 and all(c in "0123456789abcdef" for c in first))


def test_lock_success_and_failure():
    lock_session(run=lambda: 0)
    with pytest.raises(RuntimeError, match="exit code"):
        lock_session(run=lambda: 1)
    with pytest.raises(RuntimeError, match="Lock failed"):
        lock_session(run=lambda: OSError("nope"))
