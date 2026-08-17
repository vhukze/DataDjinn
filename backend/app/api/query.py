from fastapi import APIRouter, BackgroundTasks, HTTPException, status

from app.db.connection_manager import connection_manager
from app.db.error_utils import friendly_error
from app.git_versioning.schema_history import contains_schema_mutation, schema_versioning_service
from app.db.readonly_query import count_readonly_query, execute_query
from app.db.query_editing import apply_query_data_changes
from app.schemas.query import QueryCountRequest, QueryCountResponse, QueryDataChangeRequest, QueryDataChangeResponse, QueryRequest, QueryResponse

router = APIRouter(prefix="/query", tags=["query"])


@router.post("", response_model=QueryResponse)
def query(request: QueryRequest, background_tasks: BackgroundTasks) -> QueryResponse:
    engine = connection_manager.get_engine(request.connection_id)

    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        response = execute_query(engine, request.sql, request.limit, request.offset, request.database, request.pg_database)
        if contains_schema_mutation(request.sql):
            schema_versioning_service.schedule_snapshot(
                background_tasks, request.connection_id, "SQL 编辑器执行结构变更"
            )
        return response
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc


@router.post("/count", response_model=QueryCountResponse)
def count_query(request: QueryCountRequest) -> QueryCountResponse:
    engine = connection_manager.get_engine(request.connection_id)
    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")

    try:
        total_count = count_readonly_query(
            engine,
            request.sql,
            request.database,
            request.pg_database,
        )
        return QueryCountResponse(total_count=total_count)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc


@router.put("/data", response_model=QueryDataChangeResponse)
def update_query_data(request: QueryDataChangeRequest) -> QueryDataChangeResponse:
    engine = connection_manager.get_engine(request.connection_id)
    if engine is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="连接已关闭，请先打开连接")
    try:
        return QueryDataChangeResponse(updated_count=apply_query_data_changes(engine, request))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=friendly_error(exc)) from exc
