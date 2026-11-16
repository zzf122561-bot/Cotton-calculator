"""One-shot private hash bootstrap. Never run by the resident API."""
import argparse
import sqlite3
from pathlib import Path
from machine_api import initialize_database

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--bootstrap", type=Path, default=Path("/run/secrets/bootstrap.private.json"))
    options = parser.parse_args()
    try:
        initialize_database(options.database, options.bootstrap)
    except (ValueError, OSError, TypeError, KeyError, sqlite3.Error):
        parser.exit(1, "Initialization refused or failed; no existing database was replaced.\n")
    print("Initialization complete: machine-cloud-20261003")

if __name__ == "__main__":
    main()
