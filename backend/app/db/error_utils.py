from pymysql.err import OperationalError as MySQLOperationalError
from pymysql.err import ProgrammingError as MySQLProgrammingError
try:
    from redis.exceptions import AuthenticationError as RedisAuthenticationError
    from redis.exceptions import ConnectionError as RedisConnectionError
    from redis.exceptions import RedisError
    from redis.exceptions import ResponseError as RedisResponseError
    from redis.exceptions import TimeoutError as RedisTimeoutError
except ImportError:  # pragma: no cover - optional runtime dependency
    RedisAuthenticationError = None
    RedisConnectionError = None
    RedisError = None
    RedisResponseError = None
    RedisTimeoutError = None

from sqlalchemy.exc import OperationalError, ProgrammingError

try:
    from dmPython import DatabaseError as DMDatabaseError
except ImportError:  # pragma: no cover - optional runtime dependency
    DMDatabaseError = None


def friendly_error(exc: Exception) -> str:
    causes = _collect_causes(exc)
    cause = causes[-1]

    for item in causes:
        dm_message = _dm_error_message(item)
        if dm_message:
            return dm_message

    cause_message = str(cause)
    if 'Timeout reading from socket' in cause_message:
        return 'Redis 连接超时，请检查主机和端口是否正确、Redis 服务是否已启动、网络或防火墙是否放行该端口'

    if RedisError is not None and isinstance(cause, RedisError):
        if RedisTimeoutError is not None and isinstance(cause, RedisTimeoutError):
            return 'Redis 连接超时，请检查主机和端口是否正确、Redis 服务是否已启动、网络或防火墙是否放行该端口'
        if RedisConnectionError is not None and isinstance(cause, RedisConnectionError):
            return '无法连接到 Redis 服务，请检查主机和端口是否正确、Redis 服务是否已启动、网络或防火墙是否放行该端口'
        if RedisAuthenticationError is not None and isinstance(cause, RedisAuthenticationError):
            return 'Redis 用户名或密码错误，连接被拒绝'
        if RedisResponseError is not None and isinstance(cause, RedisResponseError):
            message = str(cause)
            if 'invalid username-password pair' in message.lower() or 'wrongpass' in message.lower():
                return 'Redis 用户名或密码错误，连接被拒绝'
            if 'db index is out of range' in message.lower():
                return 'Redis 数据库序号超出服务端配置范围，请检查默认 DB 序号'
            return f'Redis 操作失败：{message}'
        return f'Redis 操作失败：{cause}'

    if isinstance(cause, MySQLOperationalError):
        code = cause.args[0] if cause.args else 0

        if code == 1044:
            return '当前用户无权限访问该数据库'
        if code == 1045:
            return '用户名或密码错误，连接被拒绝'
        if code == 1049:
            return '目标数据库不存在'
        if code == 1142:
            return '当前用户无权限执行该操作'
        if code == 1146:
            return '数据表不存在'
        if code in {2003, 2013}:
            return '无法连接到 MySQL 服务，请检查主机和端口是否正确、数据库服务是否已启动、防火墙是否放行该端口'

        message = cause.args[1] if len(cause.args) > 1 else str(cause)
        if 'Lost connection to MySQL server' in message or "Can't connect to MySQL server" in message:
            return '无法连接到 MySQL 服务，请检查主机和端口是否正确、数据库服务是否已启动、防火墙是否放行该端口'

        return f'数据库连接或操作失败：{message}'

    if isinstance(cause, MySQLProgrammingError):
        code = cause.args[0] if cause.args else 0

        if code == 1064:
            return 'SQL 语法错误，请检查文件内容'
        if code == 1062:
            return '数据重复，违反了唯一约束'
        if code == 1054:
            return 'SQL 中引用了不存在的字段'

        return f'SQL 执行错误：{cause.args[1] if len(cause.args) > 1 else str(cause)}'

    if isinstance(exc, OperationalError) or isinstance(cause, OperationalError):
        msg = str(cause)
        return f'数据库操作失败：{msg}'

    if isinstance(exc, ProgrammingError) or isinstance(cause, ProgrammingError):
        msg = str(cause)
        return f'SQL 语句错误：{msg}'

    return str(exc)


def _collect_causes(exc: Exception) -> list[Exception]:
    causes: list[Exception] = []
    stack: list[object] = [exc]
    seen: set[int] = set()

    while stack:
        current = stack.pop(0)
        if not isinstance(current, Exception) or id(current) in seen:
            continue

        seen.add(id(current))
        causes.append(current)

        for next_exc in (getattr(current, 'orig', None), getattr(current, '__cause__', None), getattr(current, '__context__', None)):
            if isinstance(next_exc, Exception):
                stack.append(next_exc)

    return causes or [exc]


def _dm_error_message(exc: Exception) -> str | None:
    dm_code = _dm_error_code(exc)
    if dm_code is not None:
        if dm_code in {-2501, -70089}:
            return '达梦用户名或密码错误，连接被拒绝'

        return f'达梦数据库连接失败，错误码：{dm_code}'

    if DMDatabaseError is not None and isinstance(exc, DMDatabaseError):
        message = str(exc)
    else:
        message = str(exc)
        if '[CODE:' not in message:
            return None

    if '[CODE:-2501]' in message:
        return '达梦用户名或密码错误，连接被拒绝'

    return f'达梦数据库连接失败：{message}'


def _dm_error_code(exc: Exception) -> int | None:
    for arg in getattr(exc, 'args', ()): 
        code = getattr(arg, 'code', None)
        if isinstance(code, int):
            return code

        message = getattr(arg, 'message', None)
        code_from_message = _code_from_message(message) if isinstance(message, str) else None
        if code_from_message is not None:
            return code_from_message

    return _code_from_message(str(exc))


def _code_from_message(message: str) -> int | None:
    marker = '[CODE:'
    start = message.find(marker)
    if start < 0:
        return None

    end = message.find(']', start)
    if end < 0:
        return None

    try:
        return int(message[start + len(marker):end])
    except ValueError:
        return None
