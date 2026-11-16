"""Loopback-only browser fixture. Synthetic hashes; never a deployment entrypoint."""
import json
import os
from pathlib import Path
import tempfile
import uvicorn
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from machine_api import GENERATION, Settings, create_app, credential, initialize_database

def main():
    port = int(os.environ.get("BROWSER_CHECK_PORT", "4187"))
    root = Path(__file__).resolve().parent.parent
    build = Path(__file__).resolve().parent / "build"
    build.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="browser-api-", dir=build) as directory:
        private = Path(directory) / "bootstrap-test.json"
        private.write_text(json.dumps(dict(schemaVersion=1, migrationGeneration=GENERATION,
            defaultUser=dict(name="默认用户", doorCredential=credential("browser-door-fixture"),
                             settingsCredential=credential("browser-level1-fixture")),
            adminCredential=credential("browser-admin-fixture"))), encoding="utf-8")
        database = Path(directory) / "machine.sqlite3"
        initialize_database(database, private)
        private.unlink()
        app = create_app(Settings(database, None, f"http://127.0.0.1:{port}", secure_cookie=False,
                                  request_limit=5000, auth_limit=500))
        for folder in ["js", "assets", "icons"]:
            app.mount("/v2/" + folder, StaticFiles(directory=root / folder), name=folder)

        @app.get("/v2/")
        def index():
            return FileResponse(root / "index.html")

        @app.get("/v2/{filename}")
        def static_file(filename: str):
            if filename not in {"styles.css", "sw.js", "manifest.webmanifest"}:
                from fastapi import HTTPException
                raise HTTPException(404)
            return FileResponse(root / filename, media_type="application/javascript" if filename == "sw.js" else None)

        uvicorn.run(app, host="127.0.0.1", port=port, access_log=False, log_level="warning")

if __name__ == "__main__":
    main()
