"""Mechanically add PyPI release hashes to exact pinned dependency locks."""
import json
from pathlib import Path
import re
import sys
from urllib.request import urlopen

for name in sys.argv[1:]:
    path = Path(name)
    original = path.read_text()
    pins = re.findall(r"^([a-zA-Z0-9_.-]+)==([^\s\\]+)", original, re.M)
    if not pins:
        raise SystemExit("No exact pins found")
    rendered = ["# Exact versions and release SHA256 hashes from https://pypi.org; Python 3.12.\n"]
    rendered.extend(line + "\n" for line in original.splitlines() if line.startswith("-r "))
    for package, version in pins:
        with urlopen(f"https://pypi.org/pypi/{package}/{version}/json", timeout=30) as response:
            release = json.load(response)
        hashes = sorted({item["digests"]["sha256"] for item in release["urls"]})
        if not hashes:
            raise SystemExit("Release has no hashes")
        rendered.append(f"{package}=={version} \\\n" + " \\\n".join(f"    --hash=sha256:{value}" for value in hashes) + "\n")
    path.write_text("".join(rendered), encoding="utf-8")
    print(f"Locked {path.name}: {len(pins)} pinned releases")
