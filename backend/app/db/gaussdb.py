import re

from sqlalchemy import Engine, text


_DATABASE_DDL_PATTERN = re.compile(
    r"^\s*(?:(?:--[^\r\n]*(?:\r?\n|$))|(?:/\*.*?\*/\s*))*"
    r"(?:CREATE|DROP)\s+DATABASE\b",
    re.IGNORECASE | re.DOTALL,
)


def is_gaussdb_database_ddl(engine: Engine, statement: str) -> bool:
    """Return whether a statement must bypass a GaussDB transaction block."""
    return engine.dialect.name == "gaussdb" and bool(_DATABASE_DDL_PATTERN.match(statement))


def execute_gaussdb_database_ddl(engine: Engine, statement: str) -> int:
    """Execute GaussDB CREATE/DROP DATABASE through the JDBC auto-commit connection."""
    with engine.connect() as connection:
        dbapi_connection = getattr(connection.connection, "dbapi_connection", None)
        jdbc_connection = getattr(getattr(dbapi_connection, "_connection", None), "jconn", None)
        if jdbc_connection is None:
            raise RuntimeError("高斯数据库 JDBC 连接不支持自动提交，无法执行创建或删除数据库")

        auto_commit = jdbc_connection.getAutoCommit()
        try:
            jdbc_connection.setAutoCommit(True)
            result = connection.execute(text(statement))
            rowcount = getattr(result, "rowcount", None)
            return rowcount if rowcount is not None and rowcount >= 0 else 0
        finally:
            jdbc_connection.setAutoCommit(auto_commit)
