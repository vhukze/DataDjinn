from fastapi import APIRouter, HTTPException, status

from app.db.connection_manager import connection_manager
from app.db.error_utils import friendly_error
from app.db.mongo_utils import is_mongo_client
from app.db.redis_utils import is_redis_client
from app.db.metadata import apply_redis_data_changes, apply_table_data_changes, create_database, create_oracle_user, create_schema, create_table, drop_database, drop_db_object, get_object_ddl, get_table_comment, list_columns, list_databases, list_db_objects, list_schemas, list_tables, update_table_columns
from app.db.readonly_query import preview_table
from app.db.sql_executor import execute_sql_file
from app.schemas.metadata import ColumnsResponse, DatabaseCreateRequest, DatabaseCreateResponse, DatabasesResponse, DbObjectsResponse, ObjectDdlResponse, RedisDataChangeRequest, TableCreateRequest, TableCreateResponse, TableDataChangeRequest, TableUpdateRequest, TablesResponse
from app.schemas.query import QueryResponse, SqlFileRunRequest, SqlFileRunResponse

router = APIRouter(prefix="/connections", tags=["metadata"])


@router.get("/{connection_id}/databases", response_model=DatabasesResponse)
def get_databases(connection_id: str) -> DatabasesResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return DatabasesResponse(databases=list_databases(engine))


@router.post("/{connection_id}/databases", response_model=DatabaseCreateResponse)
def create_database_endpoint(connection_id: str, request: DatabaseCreateRequest) -> DatabaseCreateResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        if engine.dialect.name == "oracle":
            if not request.password:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Oracle 新建用户必须填写密码")
            created = create_oracle_user(engine, request.name, request.password)
        else:
            created = create_database(engine, request.name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return DatabaseCreateResponse(name=created.name, message="创建成功")


@router.delete("/{connection_id}/databases/{database_name}")
def delete_database_endpoint(connection_id: str, database_name: str) -> dict[str, str]:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        drop_database(engine, database_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return {"message": "数据库删除成功"}


@router.get("/{connection_id}/schemas", response_model=DatabasesResponse)
def get_schemas(connection_id: str, database: str | None = None) -> DatabasesResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return DatabasesResponse(databases=list_schemas(engine, database))


@router.post("/{connection_id}/schemas", response_model=DatabaseCreateResponse)
def create_schema_endpoint(connection_id: str, request: DatabaseCreateRequest, database: str | None = None) -> DatabaseCreateResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        create_schema(engine, database or engine.url.database or "postgres", request.name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return DatabaseCreateResponse(name=request.name, message="模式创建成功")


@router.get("/{connection_id}/tables", response_model=TablesResponse)
def get_tables(connection_id: str, database: str | None = None, pg_database: str | None = None, include_comment: bool = False) -> TablesResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    tables = list_tables(engine, database, pg_database)
    if include_comment:
        for table in tables:
            table.comment = get_table_comment(engine, table.name, database, pg_database)

    return TablesResponse(tables=tables)


@router.post("/{connection_id}/tables", response_model=TableCreateResponse)
def create_table_endpoint(connection_id: str, request: TableCreateRequest) -> TableCreateResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        create_table(engine, request)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return TableCreateResponse(name=request.name, message="创建成功")


@router.get("/{connection_id}/objects", response_model=DbObjectsResponse)
def get_objects(connection_id: str, database: str | None = None, pg_database: str | None = None, type: str | None = None) -> DbObjectsResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    objects = list_db_objects(engine, database, pg_database, type)
    if type in {None, "table"}:
        for obj in objects:
            if obj.type == "table" and not obj.comment:
                obj.comment = get_table_comment(engine, obj.name, database, pg_database)
    return DbObjectsResponse(objects=objects)


@router.get("/{connection_id}/objects/{object_name}/ddl", response_model=ObjectDdlResponse)
def get_object_ddl_endpoint(connection_id: str, object_name: str, type: str, database: str | None = None, pg_database: str | None = None) -> ObjectDdlResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        ddl = get_object_ddl(engine, object_name, type, database, pg_database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    if not ddl:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="未找到对象 DDL")

    return ObjectDdlResponse(ddl=ddl)


@router.delete("/{connection_id}/objects/{object_name}")
def delete_object_endpoint(connection_id: str, object_name: str, type: str, database: str | None = None, pg_database: str | None = None) -> dict[str, str]:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        drop_db_object(engine, object_name, type, database, pg_database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return {"message": "对象删除成功"}


@router.get("/{connection_id}/tables/{table_name}/columns", response_model=ColumnsResponse)
def get_columns(connection_id: str, table_name: str, database: str | None = None, pg_database: str | None = None) -> ColumnsResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return ColumnsResponse(
        columns=list_columns(engine, table_name, database, pg_database),
        table_comment=get_table_comment(engine, table_name, database, pg_database),
    )


@router.get("/{connection_id}/tables/{table_name}/preview", response_model=QueryResponse)
def preview(
    connection_id: str,
    table_name: str,
    limit: int = 1000,
    offset: int = 0,
    database: str | None = None,
    pg_database: str | None = None,
    where: str | None = None,
    sort_column: str | None = None,
    sort_direction: str | None = None,
) -> QueryResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        return preview_table(engine, table_name, limit, offset, database, pg_database, where, sort_column, sort_direction)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc


@router.put("/{connection_id}/tables/{table_name}/data", response_model=QueryResponse)
def update_table_data(
    connection_id: str,
    table_name: str,
    request: TableDataChangeRequest,
    limit: int = 1000,
    offset: int = 0,
    database: str | None = None,
    pg_database: str | None = None,
    where: str | None = None,
    sort_column: str | None = None,
    sort_direction: str | None = None,
) -> QueryResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        apply_table_data_changes(engine, table_name, request, database, pg_database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return preview_table(engine, table_name, limit, offset, database, pg_database, where, sort_column, sort_direction)


@router.put("/{connection_id}/redis/data", response_model=QueryResponse)
def update_redis_data(connection_id: str, request: RedisDataChangeRequest, limit: int = 1000, offset: int = 0, database: str | None = None) -> QueryResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    if not is_redis_client(engine):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前连接不是 Redis")

    try:
        apply_redis_data_changes(engine, request, database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return preview_table(engine, "__DATADJINN_REDIS_DATABASE__", limit, offset, database)


@router.put("/{connection_id}/tables/{table_name}/columns", response_model=ColumnsResponse)
def update_columns(connection_id: str, table_name: str, request: TableUpdateRequest, database: str | None = None, pg_database: str | None = None) -> ColumnsResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        update_table_columns(engine, table_name, request.columns, database, pg_database, request.table_comment)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return ColumnsResponse(
        columns=list_columns(engine, table_name, database, pg_database),
        table_comment=get_table_comment(engine, table_name, database, pg_database),
    )


@router.post("/{connection_id}/sql-file", response_model=SqlFileRunResponse)
def run_sql_file(connection_id: str, request: SqlFileRunRequest) -> SqlFileRunResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    if is_mongo_client(engine) or is_redis_client(engine):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前连接类型不支持运行 SQL 文件，请使用查询窗口执行支持的命令")

    if engine.dialect.name == "mysql" and not request.database:
        stored = connection_manager._stored_connections.get(connection_id)
        if not stored or not stored.database:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="MySQL 连接未指定默认数据库时，请选择目标数据库")

    try:
        return execute_sql_file(engine, request.sql, request.database, request.pg_database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc
