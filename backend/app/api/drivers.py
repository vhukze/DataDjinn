from fastapi import APIRouter, HTTPException, status

from app.db.driver_manager import driver_manager
from app.db.error_utils import friendly_error
from app.db.java_runtime import detect_java_runtimes
from app.schemas.driver import DriverCreateRequest, DriverDetectRequest, DriverDetectResponse, DriverListResponse, DriverTestRequest, DriverTestResponse, JavaDetectResponse, JavaRuntimeConfigRequest, JavaRuntimeConfigResponse

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get("", response_model=DriverListResponse)
def list_drivers() -> DriverListResponse:
    return DriverListResponse(drivers=driver_manager.list_drivers())


@router.post("", response_model=dict)
def add_driver(request: DriverCreateRequest) -> dict:
    try:
        return {"driver": driver_manager.add_driver(request).model_dump()}
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.post("/detect", response_model=DriverDetectResponse)
def detect_drivers(request: DriverDetectRequest) -> DriverDetectResponse:
    detected, added = driver_manager.detect_drivers(request.database_type)
    return DriverDetectResponse(detected=detected, added=added)


@router.post("/test", response_model=DriverTestResponse)
def test_driver(request: DriverTestRequest) -> DriverTestResponse:
    try:
        driver_manager.test_driver(request.id)
        return DriverTestResponse(success=True, message="驱动可用")
    except Exception as exc:
        return DriverTestResponse(success=False, message=friendly_error(exc))


@router.get("/java", response_model=JavaDetectResponse)
def detect_java() -> JavaDetectResponse:
    runtimes = detect_java_runtimes()
    enabled, configured = driver_manager.get_jdbc_runtime_config()
    return JavaDetectResponse(runtimes=runtimes, preferred=configured or (runtimes[0]["home"] if runtimes else None), configured=configured, enabled=enabled)


@router.put("/java/config", response_model=JavaRuntimeConfigResponse)
def update_java_config(request: JavaRuntimeConfigRequest) -> JavaRuntimeConfigResponse:
    try:
        home, major, jvm_dll, enabled = driver_manager.set_jdbc_java_config(request.enabled, request.java_home)
        return JavaRuntimeConfigResponse(java_home=str(home) if home else None, major=major, jvm_path=str(jvm_dll) if jvm_dll else None, enabled=enabled)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=friendly_error(exc)) from exc


@router.delete("/{driver_id}")
def delete_driver(driver_id: str) -> dict[str, bool]:
    deleted = driver_manager.delete_driver(driver_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="驱动不存在")
    return {"success": True}
