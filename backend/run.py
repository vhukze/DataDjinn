import os

import uvicorn

from app.main import app

if __name__ == "__main__":
    port = int(os.environ.get("DATADJINN_BACKEND_PORT", "8000"))
    reload = os.environ.get("DATADJINN_BACKEND_RELOAD", "0") == "1"
    uvicorn.run(app if not reload else "app.main:app", host="127.0.0.1", port=port, reload=reload)
