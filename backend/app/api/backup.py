from fastapi import APIRouter, HTTPException, Query, status

from app.db.backup_manager import backup_manager
from app.db.error_utils import friendly_error
from app.schemas.backup import BackupCreateRequest, BackupListResponse, ExportRequest, FileOperationResponse, ImportRequest, RestoreBackupRequest

router = APIRouter(prefix="/backup", tags=["backup"])


@router.get("", response_model=BackupListResponse)
def list_backups(connection_id: str | None = Query(default=None)) -> BackupListResponse:
    return BackupListResponse(backups=backup_manager.list_backups(connection_id))


@router.post("/create", response_model=FileOperationResponse)
def create_backup(request: BackupCreateRequest) -> FileOperationResponse:
    try:
        backup = backup_manager.create_backup(request.connection_id, request.pg_database or request.database, request.output_path)
        return FileOperationResponse(success=True, message="备份完成", file_path=backup.file_path, backup=backup)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/restore", response_model=FileOperationResponse)
def restore_backup(request: RestoreBackupRequest) -> FileOperationResponse:
    try:
        backup = backup_manager.restore_backup(request.backup_id)
        return FileOperationResponse(success=True, message="恢复备份完成", file_path=backup.file_path, backup=backup)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/export", response_model=FileOperationResponse)
def export_file(request: ExportRequest) -> FileOperationResponse:
    try:
        file_path = backup_manager.export_file(request.connection_id, request.output_path, request.format, request.database, request.pg_database, request.table, request.scope, request.content)
        return FileOperationResponse(success=True, message="导出完成", file_path=str(file_path))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/import", response_model=FileOperationResponse)
def import_file(request: ImportRequest) -> FileOperationResponse:
    try:
        file_path = backup_manager.import_file(request.connection_id, request.input_path, request.database, request.pg_database, request.table)
        return FileOperationResponse(success=True, message="导入完成", file_path=str(file_path))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc
