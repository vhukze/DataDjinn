from sqlalchemy import Engine, text

from app.db.gaussdb import execute_gaussdb_database_ddl, is_gaussdb_database_ddl
from app.db.query_timeout import apply_query_timeout
from app.db.readonly_query import _split_sql_statements, _switch_clickhouse_database
from app.schemas.query import SqlFileRunResponse


def _is_schema_scoped_engine(engine: Engine) -> bool:
    return engine.dialect.name in {"postgresql", "gaussdb"}


def execute_sql_file(engine: Engine, sql: str, database: str | None = None, pg_database: str | None = None) -> SqlFileRunResponse:
    statements = _split_sql_statements(sql)

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

    engine, clickhouse_engine_changed = _switch_clickhouse_database(engine, database)
    if clickhouse_engine_changed:
        cleanup_engine = True
        database = None

    try:
        try:
            gaussdb_database_ddl = [is_gaussdb_database_ddl(engine, statement) for statement in statements]
            if any(gaussdb_database_ddl):
                if not all(gaussdb_database_ddl):
                    raise ValueError("高斯数据库的创建或删除数据库语句不能与其他 SQL 在同一个文件中混用")
                for statement in statements:
                    try:
                        execute_gaussdb_database_ddl(engine, statement)
                    except Exception as exc:
                        errors.append(str(exc))
                        rolled_back = True
                        raise
            else:
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
        except ValueError:
            raise
        except Exception:
            rolled_back = True
            if not errors:
                errors.append("SQL 文件执行失败")
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
