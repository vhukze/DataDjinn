from contextlib import contextmanager
from time import monotonic
from typing import Iterator

from sqlalchemy import Connection, text

from app.request_context import get_query_timeout_seconds


@contextmanager
def apply_query_timeout(connection: Connection) -> Iterator[None]:
    """Apply the request timeout where the active database driver supports it."""
    seconds = get_query_timeout_seconds()
    dialect = connection.dialect.name
    cleanup = None

    try:
        if dialect in {"postgresql", "gaussdb"}:
            connection.execute(text(f"SET LOCAL statement_timeout = {seconds * 1000}"))
        elif dialect == "mysql":
            connection.execute(text(f"SET SESSION MAX_EXECUTION_TIME = {seconds * 1000}"))
            cleanup = lambda: connection.execute(text("SET SESSION MAX_EXECUTION_TIME = 0"))
        elif dialect == "sqlite":
            raw_connection = connection.connection.driver_connection
            if hasattr(raw_connection, "set_progress_handler"):
                deadline = monotonic() + seconds
                raw_connection.set_progress_handler(lambda: int(monotonic() >= deadline), 1_000)
                cleanup = lambda: raw_connection.set_progress_handler(None, 0)
        elif dialect == "oracle":
            raw_connection = connection.connection.driver_connection
            if hasattr(raw_connection, "call_timeout"):
                previous_timeout = raw_connection.call_timeout
                raw_connection.call_timeout = seconds * 1000
                cleanup = lambda: setattr(raw_connection, "call_timeout", previous_timeout)
        elif dialect in {"clickhouse", "clickhousedb"}:
            connection.execute(text(f"SET max_execution_time = {seconds}"))
            cleanup = lambda: connection.execute(text("SET max_execution_time = 0"))
    except Exception:
        cleanup = None

    try:
        yield
    finally:
        if cleanup:
            try:
                cleanup()
            except Exception:
                pass
