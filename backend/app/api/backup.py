from fastapi import APIRouter, HTTPException, Query, status

from app.db.backup_manager import backup_manager
from app.db.error_utils import friendly_error
from app.git_versioning.database_history import database_versioning_service
from app.schemas.backup import BackupCreateRequest, BackupListResponse, ExportRequest, FileOperationResponse, ImportRequest, ResultExportRequest, RestoreBackupRequest

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("", response_model=BackupListResponse)
def list_backups(connection_id: str | None = Query(default=None)) -> BackupListResponse:
    return BackupListResponse(backups=backup_manager.list_backups(connection_id))


@router.post("/create", response_model=FileOperationResponse)
def create_backup(request: BackupCreateRequest) -> FileOperationResponse:
    try:
        backup = backup_manager.create_backup(
            request.connection_id,
            request.database,
            request.output_path,
            pg_database=request.pg_database,
        )
        return FileOperationResponse(success=True, message="备份完成", file_path=backup.file_path, backup=backup)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/restore", response_model=FileOperationResponse)
def restore_backup(request: RestoreBackupRequest) -> FileOperationResponse:
    backup_record = backup_manager._backups.get(request.backup_id)
    if backup_record is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="备份记录不存在")
    snapshot_id = None
    try:
        snapshot_id = database_versioning_service.prepare_write_snapshot(
            backup_record.connection_id, "恢复数据库备份前快照"
        )
        backup = backup_manager.restore_backup(request.backup_id)
        database_versioning_service.complete_write_snapshot(
            backup_record.connection_id, snapshot_id, True
        )
        return FileOperationResponse(success=True, message="恢复备份完成", file_path=backup.file_path, backup=backup)
    except Exception as exc:
        database_versioning_service.complete_write_snapshot(
            backup_record.connection_id, snapshot_id, False
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/export", response_model=FileOperationResponse)
def export_file(request: ExportRequest) -> FileOperationResponse:
    try:
        file_path = backup_manager.export_file(request.connection_id, request.output_path, request.format, request.database, request.pg_database, request.table, request.scope, request.content, request.columns)
        return FileOperationResponse(success=True, message="导出完成", file_path=str(file_path))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/export-data", response_model=FileOperationResponse)
def export_result_data(request: ResultExportRequest) -> FileOperationResponse:
    try:
        file_path = backup_manager.export_result_data(request)
        return FileOperationResponse(success=True, message="导出完成", file_path=str(file_path))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/import", response_model=FileOperationResponse)
def import_file(request: ImportRequest) -> FileOperationResponse:
    snapshot_id = None
    try:
        snapshot_id = database_versioning_service.prepare_write_snapshot(
            request.connection_id,
            "导入数据前快照",
            affected_tables=(
                [
                    database_versioning_service.table_snapshot_target(
                        request.connection_id,
                        request.table,
                        request.database,
                        request.pg_database,
                    )
                ]
                if request.table
                else None
            ),
        )
        file_path = backup_manager.import_file(request.connection_id, request.input_path, request.database, request.pg_database, request.table)
        database_versioning_service.complete_write_snapshot(
            request.connection_id, snapshot_id, True
        )
        return FileOperationResponse(success=True, message="导入完成", file_path=str(file_path))
    except Exception as exc:
        database_versioning_service.complete_write_snapshot(
            request.connection_id, snapshot_id, False
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
