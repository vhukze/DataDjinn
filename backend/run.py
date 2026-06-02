import os
import sys
from pathlib import Path

VENDORED_JPYPE_PATH = Path(__file__).resolve().parent / "vendor" / "jpype15"
if VENDORED_JPYPE_PATH.exists():
    sys.path.insert(0, str(VENDORED_JPYPE_PATH))

import uvicorn

from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("DATADJINN_BACKEND_PORT", "8000"))
    reload = os.environ.get("DATADJINN_BACKEND_RELOAD", "0") == "1"
    uvicorn.run(app if not reload else "app.main:app", host="127.0.0.1", port=port, reload=reload)
