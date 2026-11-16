import json
import sqlite3
import subprocess
import sys
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from machine_api import COOKIE, GENERATION, PREFIX, Settings, create_app, credential, initialize_database

DOOR = "synthetic-door-password"
LEVEL1 = "synthetic-settings-password"
ADMIN = "synthetic-admin-password"


@pytest.fixture(scope="session")
def hashes():
    return dict(schemaVersion=1, migrationGeneration=GENERATION,
                defaultUser=dict(name="默认用户", doorCredential=credential(DOOR), settingsCredential=credential(LEVEL1)),
                adminCredential=credential(ADMIN))


@pytest.fixture
def system(tmp_path, hashes):
    bootstrap = tmp_path / "bootstrap-test.json"
    bootstrap.write_text(json.dumps(hashes), encoding="utf-8")
    now = [1000.0]
    settings = Settings(tmp_path / "machine.sqlite3", bootstrap, "https://testserver", clock=lambda: now[0])
    initialize_database(settings.database, bootstrap)
    return create_app(settings), settings, now


class Browser:
    def __init__(self, app):
        self.client = TestClient(app, base_url="https://testserver")
        self.csrf = self.client.get(PREFIX + "/session").json()["csrf"]
        self.elevation = ""

    def get(self, path):
        return self.client.get(PREFIX + path, headers={"X-Machine-Elevation": self.elevation})

    def write(self, method, path, body=None, **headers):
        return self.client.request(method, PREFIX + path, json=body or {}, headers={
            "Origin": "https://testserver", "X-CSRF-Token": self.csrf,
            "X-Machine-Elevation": self.elevation, **headers})

    def login(self, uid=None, password=DOOR):
        uid = uid or next(user["id"] for user in self.get("/users").json() if user["name"] == "默认用户")
        response = self.write("POST", "/login", dict(userId=uid, password=password))
        if response.status_code == 200:
            self.csrf = response.json()["csrf"]
            self.elevation = ""
        return response

    def unlock(self, password=LEVEL1):
        response = self.write("POST", "/unlock", dict(password=password))
        if response.status_code == 200:
            self.elevation = response.json()["elevation"]
        return response

    def add(self, name="乙用户"):
        return self.write("POST", "/admin/users", dict(name=name, doorPassword=DOOR, doorConfirmation=DOOR,
                                                       settingsPassword=LEVEL1, settingsConfirmation=LEVEL1))


def replacement(current, new="synthetic-new-password"):
    return dict(currentPassword=current, newPassword=new, confirmation=new)


def test_roles_and_page_memory_binding(system):
    app, _, _ = system
    browser = Browser(app)
    assert browser.get("/me/config").status_code == 403
    assert browser.login().status_code == 200
    config = browser.get("/me/config").json()
    assert browser.write("PUT", "/me/config", config).status_code == 403
    assert browser.get("/admin/users").status_code == 403
    assert browser.unlock().json()["role"] == "settings"
    assert browser.write("PUT", "/me/config", config).status_code == 200
    assert browser.get("/admin/users").status_code == 403
    # Simulate reload: same cookie, but no in-memory elevation token.
    browser.elevation = ""
    assert browser.write("PUT", "/me/config", browser.get("/me/config").json()).status_code == 403
    assert browser.unlock(ADMIN).json()["role"] == "admin"
    assert browser.get("/admin/users").status_code == 200
    assert browser.write("PUT", "/me/config", browser.get("/me/config").json()).status_code == 403


def test_two_sessions_versions_and_cross_user(system):
    app, _, _ = system
    first, second, admin = Browser(app), Browser(app), Browser(app)
    admin.unlock(ADMIN)
    other_id = admin.add().json()["id"]
    first.login()
    uid = first.client.get(PREFIX + "/session").json()["user"]["id"]
    # Both users intentionally share passwords: identity comes from selected ID.
    second.login(uid)
    first.unlock()
    second.unlock()
    stale = second.get("/me/config").json()
    updated = first.get("/me/config").json()
    updated["machine"]["processingFee"] = "1400"
    assert first.write("PUT", "/me/config", updated).status_code == 200
    assert second.get("/me/config").json()["machine"]["processingFee"] == "1400"
    assert second.write("PUT", "/me/config", stale).status_code == 409
    updated["userId"] = other_id
    assert first.write("PUT", "/me/config", updated).status_code == 422
    third = Browser(app)
    assert third.login(other_id).json()["user"]["id"] == other_id
    assert third.get("/me/config").json()["machine"]["processingFee"] == "1000"
    third.elevation = first.elevation
    assert third.write("PUT", "/me/config", third.get("/me/config").json()).status_code == 403
    assert third.write("POST", f"/admin/users/{uid}/password/settings", dict(newPassword="synthetic-new-password", confirmation="synthetic-new-password")).status_code == 403


@pytest.mark.parametrize("kind,correct,wrong", [("door", DOOR, LEVEL1), ("settings", LEVEL1, DOOR)])
def test_own_password_corresponding_original_and_restart(system, kind, correct, wrong):
    app, settings, _ = system
    owner, other = Browser(app), Browser(app)
    uid = owner.login().json()["user"]["id"]
    other.login(uid)
    owner.unlock()
    assert owner.write("POST", f"/me/password/{kind}", replacement(wrong)).status_code == 401
    mismatch = replacement(correct)
    mismatch["confirmation"] = "synthetic-mismatch"
    assert owner.write("POST", f"/me/password/{kind}", mismatch).status_code == 422
    assert owner.write("POST", f"/me/password/{kind}", replacement(correct)).status_code == 200
    assert other.get("/me/config").status_code == 401
    assert owner.get("/me/config").status_code == 401
    settings.bootstrap = None
    reopened = Browser(create_app(settings))
    assert len(reopened.get("/users").json()) == 1
    if kind == "door":
        assert reopened.login(uid, DOOR).status_code == 401
        assert reopened.login(uid, "synthetic-new-password").status_code == 200
    else:
        reopened.login(uid)
        assert reopened.unlock(LEVEL1).status_code == 401
        assert reopened.unlock("synthetic-new-password").status_code == 200


def test_admin_reset_delete_identity_and_disable(system):
    app, _, _ = system
    admin, user = Browser(app), Browser(app)
    uid = user.login().json()["user"]["id"]
    admin.unlock(ADMIN)
    body = dict(newPassword="synthetic-reset-password", confirmation="synthetic-reset-password")
    assert admin.write("POST", f"/admin/users/{uid}/password/door", body).status_code == 200
    assert user.get("/me/config").status_code == 401
    user = Browser(app)
    assert user.login(uid, "synthetic-reset-password").status_code == 200
    assert admin.write("PATCH", f"/admin/users/{uid}", dict(enabled=False)).status_code == 200
    assert user.get("/me/config").status_code == 401
    assert admin.get("/users").json() == []
    assert admin.write("DELETE", f"/admin/users/{uid}").status_code == 200
    new_id = admin.add("默认用户").json()["id"]
    assert new_id != uid
    assert admin.write("POST", f"/admin/users/{uid}/password/settings", body).status_code == 404
    new_user = Browser(app)
    new_user.login(new_id)
    assert new_user.get("/me/config").json()["version"] == 1
    public = new_user.get("/users").json()
    assert set(public[0]) == {"id", "name"}


def test_admin_own_original_and_all_elevations_revoked(system):
    app, _, _ = system
    first, second = Browser(app), Browser(app)
    first.unlock(ADMIN)
    second.unlock(ADMIN)
    assert first.write("POST", "/admin/password", replacement(DOOR)).status_code == 401
    assert first.write("POST", "/admin/password", replacement(ADMIN)).status_code == 200
    assert second.get("/admin/users").status_code == 403
    assert first.get("/admin/users").status_code == 403
    assert first.unlock(ADMIN).status_code == 401
    assert first.unlock("synthetic-new-password").json()["role"] == "admin"


def test_cooldown_csrf_origin_and_no_cache(system):
    app, _, now = system
    browser = Browser(app)
    uid = browser.get("/users").json()[0]["id"]
    for _ in range(4):
        assert browser.login(uid, "synthetic-wrong").status_code == 401
    assert browser.login(uid, "synthetic-wrong").status_code == 429
    assert browser.login(uid).status_code == 429
    now[0] += 31
    assert browser.login(uid).status_code == 200
    assert browser.write("POST", "/logout", **{"Origin": "https://evil.example"}).status_code == 403
    assert browser.write("POST", "/logout", **{"X-CSRF-Token": "wrong"}).status_code == 403
    response = browser.get("/me/config")
    assert "no-store" in response.headers["Cache-Control"]
    assert response.headers["Pragma"] == "no-cache"
    session = Browser(app)
    cookie = session.client.get(PREFIX + "/session")
    # The initial session response already set the cookie.
    assert session.client.cookies.get(COOKIE)
    invalid = browser.write("POST", "/login", dict(userId=uid, password="synthetic-secret", unexpected="value"))
    assert invalid.status_code == 422 and "synthetic-secret" not in invalid.text


def test_request_limit_and_unique_names(system):
    app, settings, _ = system
    admin = Browser(app)
    admin.unlock(ADMIN)
    assert admin.add("SameName").status_code == 201
    assert admin.add("samename").status_code == 409
    settings.request_limit = 2
    assert admin.get("/users").status_code == 429


def test_bootstrap_never_repeats_and_rejects_foreign_database(system, tmp_path):
    app, settings, _ = system
    admin = Browser(app)
    admin.unlock(ADMIN)
    uid = admin.get("/users").json()[0]["id"]
    admin.write("DELETE", f"/admin/users/{uid}")
    assert Browser(create_app(settings)).get("/users").json() == []
    foreign = tmp_path / "foreign.sqlite3"
    with sqlite3.connect(foreign) as con:
        con.execute("CREATE TABLE untouched (id TEXT)")
    assert TestClient(create_app(Settings(foreign, None, settings.origin)), base_url=settings.origin).get(PREFIX + "/readyz").status_code == 503
    with pytest.raises(ValueError, match="exists"):
        initialize_database(settings.database, settings.bootstrap)


def test_initialization_rollback_and_unready(tmp_path, hashes):
    bootstrap = tmp_path / "bootstrap-test.json"
    bootstrap.write_text(json.dumps(hashes), encoding="utf-8")
    database = tmp_path / "machine.sqlite3"
    with pytest.raises(RuntimeError):
        initialize_database(database, bootstrap, before_commit=lambda: (_ for _ in ()).throw(RuntimeError("fixture")))
    assert not database.exists()
    app = create_app(Settings(database, None, "https://testserver"))
    client = TestClient(app, base_url="https://testserver")
    assert client.get(PREFIX + "/healthz").status_code == 200
    assert client.get(PREFIX + "/readyz").status_code == 503
    assert client.get(PREFIX + "/users").status_code == 503
    assert not database.exists()
    initialize_database(database, bootstrap)
    assert client.get(PREFIX + "/readyz").status_code == 200


def test_one_shot_cli_failure_atomicity_and_no_private_output(tmp_path, hashes):
    private = tmp_path / "bootstrap-test.json"
    private.write_text(json.dumps(hashes), encoding="utf-8")
    database = tmp_path / "cli.sqlite3"
    command = [sys.executable, str(Path(__file__).resolve().parents[1] / "initialize.py"),
               "--database", str(database), "--bootstrap", str(private)]
    first = subprocess.run(command, capture_output=True, text=True)
    assert first.returncode == 0 and GENERATION in first.stdout
    with sqlite3.connect(database) as con:
        original = con.execute("SELECT id FROM users").fetchall()
    second = subprocess.run(command, capture_output=True, text=True)
    assert second.returncode == 1 and "refused" in second.stderr.lower()
    assert hashes["adminCredential"]["verifierBase64"] not in first.stdout + first.stderr + second.stdout + second.stderr
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT id FROM users").fetchall() == original
    private.write_text("broken", encoding="utf-8")
    command[command.index(str(database))] = str(tmp_path / "bad.sqlite3")
    assert subprocess.run(command, capture_output=True).returncode == 1
    assert not (tmp_path / "bad.sqlite3").exists()


def test_ready_read_only_checks_schema_generation_and_works_with_probe_host(system):
    app, settings, _ = system
    browser = Browser(app)
    with sqlite3.connect(settings.database) as con:
        before = con.execute("SELECT COUNT(*) FROM users").fetchone()
    probe = TestClient(app, base_url="http://127.0.0.1:8080")
    assert probe.get(PREFIX + "/healthz").json() == {"status": "alive"}
    assert probe.get(PREFIX + "/readyz").json() == {"status": "ready"}
    assert probe.get(PREFIX + "/users").status_code == 400
    with sqlite3.connect(settings.database) as con:
        assert con.execute("SELECT COUNT(*) FROM users").fetchone() == before
        con.execute("UPDATE meta SET value='damaged' WHERE key='admin'")
    response = browser.get("/readyz")
    assert response.status_code == 503 and "damaged" not in response.text
    assert browser.get("/users").status_code == 503


def test_configuration_rejects_invalid_ranges_or_schema_without_writing(system):
    browser = Browser(system[0]); browser.login(); browser.unlock()
    original = browser.get("/me/config").json()
    for field, value in (("basis", {}), ("lintPercentage", "0"), ("lossPercentage", "99"), ("processingFee", ".")):
        candidate = json.loads(json.dumps(original)); candidate["machine"][field] = value
        assert browser.write("PUT", "/me/config", candidate).status_code == 422
    candidate = json.loads(json.dumps(original)); candidate["template"]["schemaVersion"] = True
    assert browser.write("PUT", "/me/config", candidate).status_code == 422
    assert browser.get("/me/config").json() == original
