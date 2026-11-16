"""Loopback-only synthetic preview. Temporary data; never a production entrypoint."""
from pathlib import Path
import argparse
import sqlite3
import tempfile

import uvicorn
from factory_api import initialize_factory_database, create_factory_app, pack, uid
from machine_api import Settings, credential


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4198)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    build = root / "build"
    build.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="factory-preview-", dir=build) as directory:
        database = Path(directory) / "factory.sqlite3"
        initialize_factory_database(database, "platform", credential("preview-platform-only"))
        with sqlite3.connect(database) as con:
            parameters, template = con.execute("SELECT parameters,template FROM defaults").fetchone()
            for title, login, code in [("丰收轧花厂", "factory-a", "12345678"), ("同心轧花厂", "factory-b", "87654321")]:
                factory_id = uid()
                editable = list(__import__("json").loads(parameters))
                con.execute("INSERT INTO factories VALUES (?,?,1,?,1,?,?,?,1)", (factory_id, title, code, parameters, template, pack(editable)))
                con.execute("INSERT INTO accounts VALUES (?,?,'factory',?,?)", (uid(), login, factory_id, pack(credential("preview-factory-only"))))
        app = create_factory_app(Settings(database, None, f"http://127.0.0.1:{args.port}", secure_cookie=False,
                                          request_limit=5000, auth_limit=500), root.parent / "factory")
        print(f"Synthetic local preview: http://127.0.0.1:{args.port}/v2/factory/", flush=True)
        uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
