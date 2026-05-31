from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "app": "DataDjinn",
        "version": "0.1.4",
    }
