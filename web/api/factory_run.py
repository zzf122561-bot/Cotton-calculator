"""Explicit factory runtime/initializer; separate from the legacy machine service."""
from pathlib import Path
import argparse
import json
import os

from factory_api import initialize_factory_database, create_factory_app
from machine_api import Settings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["initialize", "serve"])
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--bootstrap", type=Path)
    args = parser.parse_args()
    if args.command == "initialize":
        if not args.bootstrap:
            parser.error("initialize requires --bootstrap with hashed administrator material")
        material = json.loads(args.bootstrap.read_text(encoding="utf-8"))
        if set(material) != {"username", "credential"}:
            raise ValueError("Invalid factory bootstrap")
        initialize_factory_database(args.database, material["username"], material["credential"])
        return
    if args.bootstrap:
        parser.error("serve never accepts bootstrap")
    import uvicorn
    from run_server import parse_forwarded_allow_ips
    # Retain the existing deployment's strict proxy validation. No public defaults.
    proxy = parse_forwarded_allow_ips(os.environ.get("FORWARDED_ALLOW_IPS", ""))
    settings = Settings(args.database, None, os.environ["FACTORY_ORIGIN"])
    app = create_factory_app(settings, Path(__file__).resolve().parent.parent / "factory")
    uvicorn.run(app, host="0.0.0.0", port=8080, workers=1, access_log=False,
                proxy_headers=True, forwarded_allow_ips=",".join(proxy))


if __name__ == "__main__":
    main()
