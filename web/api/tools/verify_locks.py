"""Read/download-only validation of exact locks, official wheels and dependency closure."""
from email.parser import BytesParser
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import urlopen
from zipfile import ZipFile
from packaging.requirements import Requirement
from packaging.markers import default_environment
from packaging.tags import sys_tags
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name, parse_wheel_filename
from packaging.version import Version


def lock_pins(path, pins):
    source = path.read_text(encoding="utf-8")
    for include in re.findall(r"^-r (.+)$", source, re.M):
        lock_pins(path.parent / include, pins)
    sections = list(re.finditer(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)", source, re.M))
    for index, match in enumerate(sections):
        section = source[match.end():sections[index + 1].start() if index + 1 < len(sections) else len(source)]
        hashes = set(re.findall(r"--hash=sha256:([a-f0-9]{64})", section))
        if not hashes:
            raise ValueError("Pin without hash")
        key = canonicalize_name(match[1]); value = (match[2], hashes)
        if key in pins and pins[key] != value:
            raise ValueError("Conflicting pins")
        pins[key] = value


def lock_digests(path):
    source = path.read_text(encoding="utf-8")
    values = {str(path): sha256(path.read_bytes()).hexdigest()}
    for include in re.findall(r"^-r (.+)$", source, re.M):
        values.update(lock_digests(path.parent / include))
    return values


def read_public(url):
    if urlsplit(url).hostname not in {"pypi.org", "files.pythonhosted.org"} or urlsplit(url).scheme != "https":
        raise ValueError("Not an official public package URL")
    for attempt in range(3):
        try:
            with urlopen(url, timeout=20) as response:
                if urlsplit(response.url).hostname not in {"pypi.org", "files.pythonhosted.org"}:
                    raise ValueError("Unexpected redirect")
                return response.read()
        except (URLError, TimeoutError):
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def main():
    pins = {}; lock_pins(Path(sys.argv[1]), pins)
    tags = {tag: index for index, tag in enumerate(sys_tags())}
    signature = sha256((sys.version + "\n" + "\n".join(map(str, tags))).encode()).hexdigest()
    cache_path = Path("build/wheel-check-cache.json")
    cache_path.parent.mkdir(exist_ok=True)
    try:
        cached = json.loads(cache_path.read_text())
    except (OSError, ValueError):
        cached = {}
    if cached.get("signature") != signature:
        cached = {"signature": signature, "records": {}}
    cached["environment"] = default_environment()
    cached["extras"] = [""]
    cached["lockDigests"] = lock_digests(Path(sys.argv[1]))
    requirements = []
    for name, (version, hashes) in sorted(pins.items()):
        record = cached["records"].get(name)
        if record and record["version"] == version and record["hash"] in hashes:
            if "filename" not in record:
                release = json.loads(read_public(f"https://pypi.org/pypi/{name}/{version}/json"))
                item = next(item for item in release["urls"] if item["filename"].endswith(".whl") and item["digests"]["sha256"] == record["hash"])
                record.update(filename=item["filename"], officialUrl=item["url"], requiresPython=item["requires_python"])
            record["lockedHash"] = record["hash"]
            if record["requiresPython"] and Version(cached["environment"]["python_full_version"]) not in SpecifierSet(record["requiresPython"]):
                raise ValueError(f"Requires-Python mismatch: {name}")
            cache_path.write_text(json.dumps(cached, indent=2), encoding="utf-8")
            requirements.extend(Requirement(item) for item in record["requirements"])
            print(f"REUSED VERIFIED {name}=={version} official-wheel SHA256")
            continue
        release = json.loads(read_public(f"https://pypi.org/pypi/{name}/{version}/json"))
        compatible = []
        for item in release["urls"]:
            if not item["filename"].endswith(".whl"):
                continue
            if item["requires_python"] and Version(cached["environment"]["python_full_version"]) not in SpecifierSet(item["requires_python"]):
                continue
            _, _, _, wheel_tags = parse_wheel_filename(item["filename"])
            rank = min((tags[tag] for tag in wheel_tags if tag in tags), default=None)
            if rank is not None:
                compatible.append((rank, item))
        if not compatible:
            raise ValueError(f"No compatible wheel: {name}")
        item = min(compatible, key=lambda entry: entry[0])[1]
        data = read_public(item["url"]); actual = sha256(data).hexdigest()
        if actual != item["digests"]["sha256"] or actual not in hashes:
            raise ValueError(f"Hash mismatch: {name}")
        with ZipFile(BytesIO(data)) as wheel:
            metadata_path = next(entry for entry in wheel.namelist() if entry.endswith(".dist-info/METADATA"))
            metadata = BytesParser().parsebytes(wheel.read(metadata_path))
        if canonicalize_name(metadata["Name"]) != name or Version(metadata["Version"]) != Version(version):
            raise ValueError("Wheel identity mismatch")
        active = []
        for requirement in metadata.get_all("Requires-Dist", []):
            parsed = Requirement(requirement)
            if parsed.marker is None or parsed.marker.evaluate({"extra": ""}):
                requirements.append(parsed)
                active.append(str(parsed))
        cached["records"][name] = dict(version=version, hash=actual, lockedHash=actual, requirements=active,
            filename=item["filename"], officialUrl=item["url"], requiresPython=item["requires_python"])
        cache_path.write_text(json.dumps(cached, indent=2), encoding="utf-8")
        print(f"VERIFIED {name}=={version} official-wheel SHA256")
    for requirement in requirements:
        key = canonicalize_name(requirement.name)
        if key not in pins or Version(pins[key][0]) not in requirement.specifier:
            raise ValueError(f"Unsatisfied active dependency: {key}")
    cached["closure"] = {"wheels": len(pins), "activeDependencies": len(requirements), "status": "verified"}
    cache_path.write_text(json.dumps(cached, indent=2), encoding="utf-8")
    print(f"LOCK_CHECK_OK {len(pins)} wheels; {len(requirements)} active dependencies; no install or filesystem wheel extraction")


if __name__ == "__main__":
    main()
