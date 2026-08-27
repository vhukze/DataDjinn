from types import SimpleNamespace
from unittest.mock import patch

from app.api.connections import open_connection


def test_open_connection_does_not_schedule_a_git_snapshot() -> None:
    opened_connection = SimpleNamespace(connection_id="connection-1", is_open=True)

    with patch("app.api.connections.connection_manager.open_connection", return_value=opened_connection) as open_runtime:
        result = open_connection("connection-1", None)

    assert result is opened_connection
    open_runtime.assert_called_once_with("connection-1", None)
