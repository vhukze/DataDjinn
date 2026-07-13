import re

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
        oracle_message = _oracle_error_message(item)
        if oracle_message:
            return oracle_message

    cause_message = str(cause)
    network_message = _database_network_error_message(causes)
    if network_message:
        return network_message

    postgres_message = _postgres_like_error_message(causes)
    if postgres_message:
        return postgres_message

    if 'UnsupportedClassVersionError' in cause_message:
        match = re.search(r'class file version (\d+)\.0.*up to (\d+)\.0', cause_message)
        if match:
            required_java = int(match.group(1)) - 44
            current_java = int(match.group(2)) - 44
            return f'当前达梦 JDBC 驱动需要 Java {required_java} 或更高版本，但当前选择的是 Java {current_java}。请在驱动管理中选择 Java {required_java}+ 的 64 位 JDK/JRE 目录，或更换兼容 Java {current_java} 的达梦 JDBC 驱动'
        return '当前达梦 JDBC 驱动与 Java 版本不匹配，请在驱动管理中选择更高版本的 64 位 JDK/JRE，或更换兼容当前 Java 的达梦 JDBC 驱动'
    if 'Timeout reading from socket' in cause_message:
        return 'Redis 连接超时，请检查主机和端口是否正确、Redis 服务是否已启动、网络或防火墙是否放行该端口'

    if RedisError is not None and isinstance(cause, RedisError):
        if RedisAuthenticationError is not None and isinstance(cause, RedisAuthenticationError):
            return 'Redis 用户名或密码错误，连接被拒绝'
        if RedisResponseError is not None and isinstance(cause, RedisResponseError):
            message = str(cause)
            if 'invalid username-password pair' in message.lower() or 'wrongpass' in message.lower():
                return 'Redis 用户名或密码错误，连接被拒绝'
            if 'db index is out of range' in message.lower():
                return 'Redis 数据库序号超出服务端配置范围，请检查默认 DB 序号'
            return f'Redis 操作失败：{message}'
        if RedisTimeoutError is not None and isinstance(cause, RedisTimeoutError):
            return 'Redis 连接超时，请检查主机和端口是否正确、Redis 服务是否已启动、网络或防火墙是否放行该端口'
        if RedisConnectionError is not None and isinstance(cause, RedisConnectionError):
            return '无法连接到 Redis 服务，请检查主机和端口是否正确、Redis 服务是否已启动、网络或防火墙是否放行该端口'
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


def _all_error_messages(causes: list[Exception]) -> str:
    return "\n".join(str(cause) for cause in causes if str(cause))


def _host_port_from_message(message: str) -> str | None:
    match = re.search(r'Connection to ([^\s:]+):(\d+) refused', message, re.IGNORECASE)
    if match:
        return f'{match.group(1)}:{match.group(2)}'

    match = re.search(r'([\w.\-]+):(\d+)', message)
    if match:
        return f'{match.group(1)}:{match.group(2)}'

    return None


def _database_network_error_message(causes: list[Exception]) -> str | None:
    message = _all_error_messages(causes)
    lower_message = message.lower()
    endpoint = _host_port_from_message(message)

    if 'connection refused' in lower_message or 'connection to' in lower_message and 'refused' in lower_message:
        target = f'（{endpoint}）' if endpoint else ''
        return f'无法连接到数据库服务{target}：目标主机拒绝连接。请检查主机和端口是否正确、数据库服务是否已启动、是否监听远程地址，以及防火墙是否放行该端口。'

    if any(keyword in lower_message for keyword in ['timed out', 'timeout expired', 'the connection attempt failed', 'no route to host', 'network is unreachable']):
        target = f'（{endpoint}）' if endpoint else ''
        return f'连接数据库服务超时{target}：请检查网络是否可达、主机和端口是否正确、数据库服务是否允许远程访问，以及防火墙或安全组是否放行。'

    return None


def _postgres_like_error_message(causes: list[Exception]) -> str | None:
    message = _all_error_messages(causes)
    lower_message = message.lower()

    if 'password authentication failed' in lower_message:
        return 'PostgreSQL 用户名或密码错误，连接被拒绝。'

    if re.search(r'\bdatabase\s+["\'][^"\']+["\']\s+does not exist\b', message, re.IGNORECASE):
        return 'PostgreSQL 数据库不存在，请检查填写的数据库名。'

    function_match = re.search(r'function\s+([^\s(]+)\s*\([^)]*\)\s+does not exist', message, re.IGNORECASE)
    if function_match:
        function_name = function_match.group(1)
        if function_name.lower() == 'group_concat':
            return 'PostgreSQL 函数不存在：GROUP_CONCAT。请使用 string_agg(字段, 分隔符)。'
        return f'PostgreSQL 函数不存在：{function_name}。请检查函数名称、参数类型或扩展是否已安装。'

    if 'no pg_hba.conf entry' in lower_message:
        return 'PostgreSQL 拒绝当前客户端访问，请检查服务端 pg_hba.conf 白名单、用户、数据库和认证方式配置。'

    if 'psqlexception' in lower_message and 'fatal:' in lower_message:
        fatal = re.search(r'FATAL:\s*([^\n\r]+)', message, re.IGNORECASE)
        if fatal:
            return f'PostgreSQL 连接失败：{fatal.group(1).strip()}'

    return None


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


def _oracle_error_message(exc: Exception) -> str | None:
    message = str(exc)
    ora_code = _ora_code_from_message(message)
    if ora_code is None:
        return None

    if ora_code == 1017:
        return 'Oracle 用户名或密码错误，连接被拒绝'
    if ora_code == 12154:
        return 'Oracle 连接标识解析失败，请检查主机、端口和服务名是否正确'
    if ora_code == 12514:
        return 'Oracle 监听器无法识别当前服务名，请检查填写的服务名'
    if ora_code == 12505:
        return 'Oracle 监听器无法识别当前 SID / 服务配置，请检查连接参数'
    if ora_code == 12541:
        return '无法连接到 Oracle 监听器，请检查主机、端口和数据库服务是否已启动'
    if ora_code == 1031:
        return 'Oracle 当前用户权限不足，无法执行该操作'
    if ora_code == 942:
        return 'Oracle 表或视图不存在'
    if ora_code == 904:
        return 'Oracle SQL 中引用了不存在的字段'
    if ora_code == 955:
        return 'Oracle 对象已存在，名称重复'

    return f'Oracle 数据库操作失败：{message}'


def _ora_code_from_message(message: str) -> int | None:
    match = re.search(r'ORA-(\d{5})', message, re.IGNORECASE)
    if not match:
        return None

    try:
        return int(match.group(1))
    except ValueError:
        return None


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
