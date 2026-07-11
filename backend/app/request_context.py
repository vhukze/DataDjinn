from contextvars import ContextVar

DEFAULT_QUERY_TIMEOUT_SECONDS = 15 * 60
MIN_QUERY_TIMEOUT_SECONDS = 60
MAX_QUERY_TIMEOUT_SECONDS = 120 * 60

_query_timeout_seconds: ContextVar[int] = ContextVar(
    "query_timeout_seconds",
    default=DEFAULT_QUERY_TIMEOUT_SECONDS,
)


def normalize_query_timeout_seconds(value: str | int | None) -> int:
    try:
        seconds = int(value) if value is not None else DEFAULT_QUERY_TIMEOUT_SECONDS
    except (TypeError, ValueError):
        return DEFAULT_QUERY_TIMEOUT_SECONDS

    if MIN_QUERY_TIMEOUT_SECONDS <= seconds <= MAX_QUERY_TIMEOUT_SECONDS:
        return seconds

    return DEFAULT_QUERY_TIMEOUT_SECONDS


def get_query_timeout_seconds() -> int:
    return _query_timeout_seconds.get()


def set_query_timeout_seconds(seconds: int):
    return _query_timeout_seconds.set(seconds)


def reset_query_timeout_seconds(token) -> None:
    _query_timeout_seconds.reset(token)
