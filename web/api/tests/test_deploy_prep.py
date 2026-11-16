"""Resident/proxy deployment contracts; synthetic addresses and existing API fixtures."""

import ast
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
import uvicorn

from machine_api import PREFIX
import run_server
from test_api import ADMIN, hashes, system

ROOT = Path(__file__).resolve().parents[1]
PROXY = "192.0.2.10"


@pytest.mark.parametrize("value", [
    None, "", " \t", "*", "192.0.2.10,*", "0.0.0.0/0", "192.0.2.0/24",
    "192.0.2.10/32", "::/0", "2001:db8::/64", "2001:db8::10/128",
    "localhost", "proxy.example", "192.0.2.10:8080", "[2001:db8::10]",
    "[2001:db8::10]:8080", "fe80::1%eth0", ",192.0.2.10", "192.0.2.10,",
    "192.0.2.10,,2001:db8::10", "999.2.3.4", "192.000.2.10", "not-an-ip",
    "0.0.0.0", "::", "224.0.0.1", "ff02::1",
])
def test_proxy_whitelist_rejects_missing_broad_or_invalid_values(value):
    with pytest.raises(run_server.StartupConfigurationError, match="FORWARDED_ALLOW_IPS"):
        run_server.parse_forwarded_allow_ips(value)


@pytest.mark.parametrize("value,expected", [
    (PROXY, (PROXY,)), ("127.0.0.1", ("127.0.0.1",)), ("::1", ("::1",)),
    ("2001:0DB8:0:0::10", ("2001:db8::10",)),
    (" 192.0.2.10 , 2001:0DB8::10,192.0.2.10 ", (PROXY, "2001:db8::10")),
    ("::ffff:192.0.2.10", ("::ffff:c000:20a",)),
])
def test_proxy_whitelist_accepts_explicit_ipv4_ipv6_and_normalizes(value, expected):
    assert run_server.parse_forwarded_allow_ips(value) == expected


@pytest.mark.parametrize("value", [None, "", "*", "192.0.2.10/32", "proxy.example"])
def test_invalid_startup_never_runs_uvicorn(monkeypatch, capsys, value):
    if value is None:
        monkeypatch.delenv("FORWARDED_ALLOW_IPS", raising=False)
    else:
        monkeypatch.setenv("FORWARDED_ALLOW_IPS", value)
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: pytest.fail("Startup must fail before serving"))
    assert run_server.main() == 2
    output = capsys.readouterr()
    assert not output.out
    assert output.err.startswith("Startup refused: FORWARDED_ALLOW_IPS")
    if value == "proxy.example":
        assert value not in output.err


def startup_options(monkeypatch, whitelist=PROXY):
    calls = []
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", whitelist)
    monkeypatch.setenv("WEB_CONCURRENCY", "9")
    monkeypatch.setattr(uvicorn, "run", lambda app, **options: calls.append((app, options)))
    assert run_server.main() == 0
    assert len(calls) == 1
    assert calls[0][0] == "machine_api:production_app"
    return calls[0][1]


def test_resident_startup_is_fixed_single_worker_and_explicit_trust(monkeypatch):
    assert startup_options(monkeypatch, "192.0.2.10,2001:0DB8::10") == dict(
        factory=True, host="0.0.0.0", port=8080, workers=1, access_log=False,
        proxy_headers=True, forwarded_allow_ips="192.0.2.10,2001:db8::10")


def test_other_python_version_fails_before_serving(monkeypatch, capsys):
    monkeypatch.setattr(sys, "version_info", (3, 13, 0))
    monkeypatch.setenv("FORWARDED_ALLOW_IPS", PROXY)
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: pytest.fail("Wrong Python version must not serve"))
    assert run_server.main() == 2
    assert "Python 3.12 is required" in capsys.readouterr().err


def test_invalid_cli_configuration_leaves_missing_database_and_private_input_untouched(tmp_path):
    database = tmp_path / "missing.sqlite3"
    private = tmp_path / "bootstrap-test.json"
    marker = "synthetic-must-not-read-marker"
    private.write_text(marker, encoding="utf-8")
    environment = dict(os.environ, FORWARDED_ALLOW_IPS="*", MACHINE_DATABASE=str(database),
                       MACHINE_ORIGIN="https://testserver", MACHINE_BOOTSTRAP=str(private))
    result = subprocess.run([sys.executable, str(ROOT / "run_server.py")], env=environment,
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 2
    assert "Startup refused: FORWARDED_ALLOW_IPS" in result.stderr
    assert marker not in result.stdout + result.stderr
    assert str(private) not in result.stdout + result.stderr
    assert not database.exists()
    assert private.read_text(encoding="utf-8") == marker


def proxy_application(app, monkeypatch, whitelist=PROXY):
    observed = []

    async def observe(scope, receive, send):
        if scope["type"] == "http":
            observed.append((scope["client"], scope["scheme"]))
        await app(scope, receive, send)

    # Load the actual locked Uvicorn middleware with options from the resident entrypoint.
    # This exercises ASGI source resolution without claiming real TCP/container execution.
    config = uvicorn.Config(lambda: observe, log_config=None, **startup_options(monkeypatch, whitelist))
    config.load()
    return config.loaded_app, observed


@pytest.mark.parametrize("peer", [PROXY, "2001:db8::10"])
def test_trusted_proxy_separates_client_request_limits(system, monkeypatch, peer):
    app, settings, _ = system
    wrapped, observed = proxy_application(app, monkeypatch, f"{PROXY},2001:db8::10")
    with TestClient(wrapped, base_url=settings.origin, client=(peer, 50000)) as client:
        first = {"X-Forwarded-For": "198.51.100.20", "X-Forwarded-Proto": "https"}
        second = {"X-Forwarded-For": "2001:db8:1::20", "X-Forwarded-Proto": "https"}
        for _ in range(settings.request_limit):
            assert client.get(PREFIX + "/users", headers=first).status_code == 200
        assert client.get(PREFIX + "/users", headers=first).status_code == 429
        assert client.get(PREFIX + "/users", headers=second).status_code == 200
    assert observed[0] == (("198.51.100.20", 0), "https")
    assert observed[-1] == (("2001:db8:1::20", 0), "https")
    with sqlite3.connect(settings.database) as con:
        counts = dict(con.execute("SELECT scope,count FROM limits"))
    assert counts["ip:198.51.100.20"] == 120
    assert counts["ip:2001:db8:1::20"] == 1
    assert "ip:" + peer not in counts


def test_trusted_proxy_chain_uses_rightmost_untrusted_client_and_missing_header_uses_peer(system, monkeypatch):
    app, settings, _ = system
    wrapped, observed = proxy_application(app, monkeypatch, f"{PROXY},192.0.2.11")
    with TestClient(wrapped, base_url="http://testserver", client=(PROXY, 50000)) as client:
        response = client.get(PREFIX + "/users", headers={
            "X-Forwarded-For": "203.0.113.99,198.51.100.20,192.0.2.11", "X-Forwarded-Proto": "https"})
        assert response.status_code == 200
        assert observed[-1] == (("198.51.100.20", 0), "https")
        assert client.get(PREFIX + "/users").status_code == 200
        assert observed[-1] == ((PROXY, 50000), "http")


@pytest.mark.parametrize("peer", ["198.51.100.20", "2001:db8:1::20"])
def test_untrusted_direct_peer_cannot_rotate_forwarded_headers_to_escape_request_limit(system, monkeypatch, peer):
    app, settings, _ = system
    wrapped, observed = proxy_application(app, monkeypatch)
    with TestClient(wrapped, base_url=settings.origin, client=(peer, 50000)) as client:
        for number in range(settings.request_limit):
            assert client.get(PREFIX + "/users", headers={
                "X-Forwarded-For": f"203.0.113.{number + 1}", "X-Forwarded-Proto": "http"}).status_code == 200
        assert client.get(PREFIX + "/users", headers={"X-Forwarded-For": "192.0.2.30"}).status_code == 429
    assert all(value == ((peer, 50000), "https") for value in observed)
    with sqlite3.connect(settings.database) as con:
        counts = dict(con.execute("SELECT scope,count FROM limits"))
    assert counts == {"ip:" + peer: 120}


def test_untrusted_direct_peer_cannot_rotate_forwarded_headers_to_escape_auth_limit(system, monkeypatch):
    app, settings, _ = system
    peer = "198.51.100.20"
    wrapped, _ = proxy_application(app, monkeypatch)
    with TestClient(wrapped, base_url=settings.origin, client=(peer, 50000)) as client:
        csrf = client.get(PREFIX + "/session").json()["csrf"]
        for number in range(settings.auth_limit):
            response = client.post(PREFIX + "/unlock", json={"password": ADMIN}, headers={
                "Origin": settings.origin, "X-CSRF-Token": csrf,
                "X-Forwarded-For": f"203.0.113.{number + 1}"})
            assert response.status_code == 200
        response = client.post(PREFIX + "/unlock", json={"password": ADMIN}, headers={
            "Origin": settings.origin, "X-CSRF-Token": csrf, "X-Forwarded-For": "192.0.2.30"})
        assert response.status_code == 429 and int(response.headers["Retry-After"]) > 0
    with sqlite3.connect(settings.database) as con:
        assert con.execute("SELECT count FROM limits WHERE scope=?", ("auth:" + peer,)).fetchone() == (30,)
        assert con.execute("SELECT COUNT(*) FROM limits WHERE scope LIKE 'auth:%'").fetchone() == (1,)


def test_resident_entrypoint_does_not_import_initializer_or_business_factory():
    tree = ast.parse((ROOT / "run_server.py").read_text(encoding="utf-8"))
    imports = {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names}
    assert imports == {"ipaddress", "os", "sys", "uvicorn"}
    assert not any(isinstance(node, ast.ImportFrom) for node in ast.walk(tree))


def test_docker_source_contract_requires_administrator_base_and_offline_hash_checked_wheels():
    source = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    lines = source.splitlines()
    assert re.fullmatch(r"ARG PYTHON_BASE=python:3\.12-slim-bookworm@sha256:[0-9a-f]{64}", lines[0])
    assert [line for line in lines if line.startswith("FROM ")] == ["FROM ${PYTHON_BASE} AS dependencies", "FROM ${PYTHON_BASE}"]
    dependency, resident = source.split("\nFROM ${PYTHON_BASE}\n", 1)
    assert "COPY wheelhouse/ /wheelhouse/" in dependency
    for option in ("--no-index", "--find-links=/wheelhouse", "--only-binary=:all:", "--require-hashes", "--target=/opt/python"):
        assert option in source
    assert "PYTHONPATH=/opt/python python -m pip check" in dependency
    assert "COPY --from=dependencies /opt/python /opt/python" in resident
    assert "PYTHONPATH=/opt/python" in resident
    assert "wheelhouse" not in resident
    assert "COPY machine_api.py initialize.py run_server.py ./" in resident
    assert "COPY manager-tools/backup_sqlite.py ./manager-tools/backup_sqlite.py" in resident
    assert "USER 10001" in resident
    command = next(line for line in source.splitlines() if line.startswith("CMD "))
    assert json.loads(command[4:]) == ["python", "run_server.py"]
    assert "--no-proxy-headers" not in source


def test_dockerignore_allows_only_public_inputs_and_wheels():
    rules = [line.strip() for line in (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
             if line.strip() and not line.lstrip().startswith("#")]
    assert rules[0] == "**"
    assert set(rules[1:]) == {"!Dockerfile", "!requirements.lock", "!machine_api.py", "!initialize.py",
                             "!run_server.py", "!wheelhouse/", "!wheelhouse/*.whl",
                             "!manager-tools/", "!manager-tools/backup_sqlite.py"}


def test_public_environment_example_is_fail_closed_and_has_no_bootstrap_setting():
    values = dict(line.split("=", 1) for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines()
                  if line.strip() and not line.lstrip().startswith("#"))
    assert values["FORWARDED_ALLOW_IPS"] == ""
    assert set(values) == {"MACHINE_DATABASE", "MACHINE_ORIGIN", "FORWARDED_ALLOW_IPS"}
