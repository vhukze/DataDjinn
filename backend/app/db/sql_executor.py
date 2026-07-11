import sqlparse
from sqlalchemy import Engine, text

from app.db.query_timeout import apply_query_timeout
from app.schemas.query import SqlFileRunResponse


def _is_schema_scoped_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"postgresql", "gaussdb"}


def execute_sql_file(engine: Engine, sql: str, database: str | None = None, pg_database: str | None = None) -> SqlFileRunResponse:
    statements = [str(s).strip() for s in sqlparse.parse(sql) if str(s).strip()]

    if not statements:
        raise ValueError("SQL 文件中未找到可执行的语句")

    errors: list[str] = []
    rolled_back = False

    if pg_database and _is_schema_scoped_engine(engine):
        if engine.dialect.name == "postgresql":
            from sqlalchemy import create_engine

            engine = create_engine(engine.url.set(database=pg_database), pool_pre_ping=True)
            cleanup_engine = True
        else:
            factory = getattr(engine, "_datadjinn_engine_factory", None)
            if callable(factory):
                engine = factory(pg_database)
                cleanup_engine = True
    else:
        cleanup_engine = False

    try:
        try:
            with engine.begin() as connection:
                mysql_foreign_key_checks_disabled = False
                if database:
                    preparer = engine.dialect.identifier_preparer
                    quoted = preparer.quote(database)

                    if _is_schema_scoped_engine(engine):
                        connection.execute(text(f"SET search_path TO {quoted}"))
                    elif engine.dialect.name in {"dm", "dmPython"}:
                        connection.execute(text(f"SET SCHEMA {quoted}"))
                    elif engine.dialect.name == "oracle":
                        connection.execute(text(f"ALTER SESSION SET CURRENT_SCHEMA = {quoted}"))
                    elif engine.dialect.name == "mysql":
                        connection.execute(text(f"USE {quoted}"))
                        connection.execute(text("SET FOREIGN_KEY_CHECKS=0"))
                        mysql_foreign_key_checks_disabled = True
                    elif engine.dialect.name in {"clickhouse", "clickhousedb"}:
                        connection.execute(text(f"USE {quoted}"))

                try:
                    with apply_query_timeout(connection):
                        for statement in statements:
                            try:
                                connection.execute(text(statement))
                            except Exception as exc:
                                errors.append(str(exc))
                                rolled_back = True
                                raise
                finally:
                    if mysql_foreign_key_checks_disabled:
                        connection.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        except Exception:
            pass
    finally:
        if cleanup_engine:
            engine.dispose()

    if rolled_back:
        return SqlFileRunResponse(
            success_count=0,
            failed_count=len(statements),
            errors=errors
        )

    return SqlFileRunResponse(
        success_count=len(statements),
        failed_count=0,
        errors=[]
    )
