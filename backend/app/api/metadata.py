from fastapi import APIRouter, HTTPException, status

from app.db.connection_manager import connection_manager
from app.db.error_utils import friendly_error
from app.db.metadata import apply_table_data_changes, create_database, create_schema, list_columns, list_databases, list_db_objects, list_schemas, list_tables, update_table_columns
from app.db.readonly_query import preview_table
from app.db.sql_executor import execute_sql_file
from app.schemas.metadata import ColumnsResponse, DatabaseCreateRequest, DatabaseCreateResponse, DatabasesResponse, DbObjectsResponse, TableDataChangeRequest, TableUpdateRequest, TablesResponse
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
        create_database(engine, request.name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return DatabaseCreateResponse(name=request.name, message="数据库创建成功")


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
def get_tables(connection_id: str, database: str | None = None, pg_database: str | None = None) -> TablesResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return TablesResponse(tables=list_tables(engine, database, pg_database))


@router.get("/{connection_id}/objects", response_model=DbObjectsResponse)
def get_objects(connection_id: str, database: str | None = None, pg_database: str | None = None, type: str | None = None) -> DbObjectsResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return DbObjectsResponse(objects=list_db_objects(engine, database, pg_database, type))


@router.get("/{connection_id}/tables/{table_name}/columns", response_model=ColumnsResponse)
def get_columns(connection_id: str, table_name: str, database: str | None = None, pg_database: str | None = None) -> ColumnsResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return ColumnsResponse(columns=list_columns(engine, table_name, database, pg_database))


@router.get("/{connection_id}/tables/{table_name}/preview", response_model=QueryResponse)
def preview(connection_id: str, table_name: str, limit: int = 1000, offset: int = 0, database: str | None = None, pg_database: str | None = None) -> QueryResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    return preview_table(engine, table_name, limit, offset, database, pg_database)


@router.put("/{connection_id}/tables/{table_name}/data", response_model=QueryResponse)
def update_table_data(connection_id: str, table_name: str, request: TableDataChangeRequest, limit: int = 1000, offset: int = 0, database: str | None = None, pg_database: str | None = None) -> QueryResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        apply_table_data_changes(engine, table_name, request, database, pg_database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc

    return preview_table(engine, table_name, limit, offset, database, pg_database)


@router.put("/{connection_id}/tables/{table_name}/columns", response_model=ColumnsResponse)
def update_columns(connection_id: str, table_name: str, request: TableUpdateRequest, database: str | None = None) -> ColumnsResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        update_table_columns(engine, table_name, request.columns, database)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc

    return ColumnsResponse(columns=list_columns(engine, table_name, database))


@router.post("/{connection_id}/sql-file", response_model=SqlFileRunResponse)
def run_sql_file(connection_id: str, request: SqlFileRunRequest) -> SqlFileRunResponse:
    engine = connection_manager.get_engine(connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

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
