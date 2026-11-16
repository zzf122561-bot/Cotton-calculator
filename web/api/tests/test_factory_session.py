"""Page-only manager authentication against the unchanged synthetic factory schema."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from test_factory import Client, ORIGIN, admin_hash, env, permissions
from factory_api import MANAGER_COOKIE, MANAGER_KIND, MANAGER_TTL, PREFIX, VISITOR_COOKIE, create_factory_app
from machine_api import digest


def session_row(database, token):
    with sqlite3.connect(database) as con:
        con.row_factory = sqlite3.Row
        row = con.execute("SELECT * FROM sessions WHERE token=?", (digest(token),)).fetchone()
        return dict(row) if row else None


def business_rows(database):
    with sqlite3.connect(database) as con:
        return {table: con.execute(f"SELECT * FROM {table} ORDER BY rowid").fetchall()
                for table in ("meta", "defaults", "accounts", "factories", "visitors", "contacts")}


@pytest.mark.parametrize("role", ["platform", "factory"])
def test_absolute_hour_and_session_cookie_without_renewal(env, role):
    app, _, (a, _), database, clock, _ = env
    client = Client(app, True)
    login = client.call("/login", dict(username="platform" if role == "platform" else "alpha",
                                     password="test-platform-only" if role == "platform" else "test-factory-only"))
    assert login.status_code == 200 and login.json()["identity"]["role"] == role
    assert login.json()["expiresIn"] == MANAGER_TTL == 3600
    cookie = login.headers["set-cookie"].lower()
    assert "max-age" not in cookie and "expires=" not in cookie
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/v2/factory-api" in cookie
    token = client.client.cookies.get(MANAGER_COOKIE)
    stored = session_row(database, token)
    assert stored["kind"] == MANAGER_KIND and stored["csrf"] == digest(client.proof)
    assert stored["csrf"] != client.proof and stored["expires"] == clock[0] + 3600
    path = "/config/" + a["id"]
    clock[0] += 3599
    read = client.get(path)
    assert read.status_code == 200 and "set-cookie" not in read.headers
    config = read.json()
    assert client.call(path, config, "PUT").status_code == 200
    assert session_row(database, token) == stored
    config["version"] += 1
    clock[0] += 1
    assert client.get(path).status_code == 401
    assert client.call(path, config, "PUT").status_code == 401
    assert client.get(f"/factories/{a['id']}/contacts.csv").status_code == 401
    assert session_row(database, token) == stored
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT version FROM factories WHERE id=?", (a["id"],)).fetchone()[0] == config["version"]


@pytest.mark.parametrize("proof_mode", ["missing", "wrong", "stored-digest", "legacy-eight-hour"])
def test_cookie_without_current_page_proof_cannot_authorize(env, proof_mode):
    app, admin, (a, _), database, clock, _ = env
    config = admin.get("/config/" + a["id"]).json()
    proof = {"missing": "", "wrong": "incorrect-proof", "stored-digest": digest(admin.proof),
             "legacy-eight-hour": admin.proof}[proof_mode]
    if proof_mode == "legacy-eight-hour":
        with sqlite3.connect(database) as con:
            con.execute("UPDATE sessions SET kind='manager',csrf=?,expires=? WHERE token=?",
                        (admin.proof, clock[0] + 8 * 3600, digest(admin.client.cookies.get(MANAGER_COOKIE))))
    copied = TestClient(app, base_url=ORIGIN)
    copied.cookies.update(admin.client.cookies)
    headers = {"X-Page-Proof": proof} if proof else {}
    assert copied.get(PREFIX + "/manage/factories", headers=headers).status_code == 401
    assert copied.get(PREFIX + f"/manage/factories/{a['id']}/contacts.csv", headers=headers).status_code == 401
    headers.update({"Origin": ORIGIN, "X-CSRF-Token": admin.csrf})
    assert copied.put(PREFIX + "/manage/config/" + a["id"], json=config, headers=headers).status_code == 401
    refreshed = copied.get(PREFIX + "/manage/session")
    assert refreshed.status_code == 200 and refreshed.json()["identity"] is None
    assert refreshed.json()["csrf"] != admin.proof
    assert session_row(database, admin.client.cookies.get(MANAGER_COOKIE)) is None


def test_management_write_requires_csrf_as_well_as_page_proof(env):
    _, admin, (a, _), *_ = env
    path = "/config/" + a["id"]
    config = admin.get(path).json()
    for csrf in ("", "wrong-csrf"):
        response = admin.client.put(PREFIX + "/manage" + path, json=config,
                                    headers={"Origin": ORIGIN, "X-Page-Proof": admin.proof, "X-CSRF-Token": csrf})
        assert response.status_code == 403
    assert admin.get(path).json() == config


@pytest.mark.parametrize("role", ["platform", "factory"])
@pytest.mark.parametrize("action", ["refresh", "logout"])
def test_page_exit_preserves_business_data_visitor_and_existing_schema(env, role, action):
    app, _, (a, _), database, _, settings = env
    person = Client(app).join(a["code"])
    person.calc()
    client = Client(app, True).login("platform" if role == "platform" else "alpha",
                                   "test-platform-only" if role == "platform" else "test-factory-only")
    client.client.cookies.update(person.client.cookies)
    before, visitor_session = business_rows(database), session_row(database, person.client.cookies.get(VISITOR_COOKIE))
    with sqlite3.connect(database) as con:
        schema = con.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").fetchall()
    old_token, old_proof = client.client.cookies.get(MANAGER_COOKIE), client.proof
    if action == "refresh":
        response = client.get("/session")
        assert response.status_code == 200 and response.json()["identity"] is None
        assert "max-age" not in response.headers["set-cookie"].lower() and "expires=" not in response.headers["set-cookie"].lower()
    else:
        assert client.call("/logout").status_code == 200
    assert session_row(database, old_token) is None
    assert session_row(database, person.client.cookies.get(VISITOR_COOKIE)) == visitor_session
    assert client.client.cookies.get(VISITOR_COOKIE) == person.client.cookies.get(VISITOR_COOKIE)
    assert business_rows(database) == before
    assert client.get("/factories").status_code == 401
    restarted = TestClient(create_factory_app(settings), base_url=ORIGIN)
    restarted.cookies.update(person.client.cookies)
    restarted.cookies.set(MANAGER_COOKIE, old_token, path=PREFIX)
    assert restarted.get(PREFIX + "/manage/factories", headers={"X-Page-Proof": old_proof}).status_code == 401
    assert restarted.get(PREFIX + "/context").json()["factory"]["id"] == a["id"]
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT type,name,sql FROM sqlite_master ORDER BY type,name").fetchall() == schema
    assert business_rows(database) == before
    assert person.calc().status_code == 200


def test_manager_cookie_cannot_revoke_or_restore_visitor_identity(env):
    app, _, (a, _), database, *_ = env
    person = Client(app).join(a["code"])
    token = person.client.cookies.get(VISITOR_COOKIE)
    before = session_row(database, token)
    mixed = TestClient(app, base_url=ORIGIN)
    mixed.cookies.set(MANAGER_COOKIE, token, path=PREFIX)
    denied = mixed.post(PREFIX + "/manage/logout", json={},
                        headers={"Origin": ORIGIN, "X-CSRF-Token": person.csrf, "X-Page-Proof": person.csrf})
    assert denied.status_code == 401
    assert mixed.get(PREFIX + "/manage/session").json()["identity"] is None
    assert session_row(database, token) == before
    assert person.get("/context").json()["factory"]["id"] == a["id"]


def test_expiry_after_middleware_rejects_handler_write(env):
    _, admin, (a, _), database, clock, settings = env
    path = "/config/" + a["id"]
    config = admin.get(path).json()
    start, reads = clock[0], []

    def crossing_clock():
        reads.append(True)
        # Middleware throttling and session validation occur before handler work.
        return start + (3599 if len(reads) <= 2 else 3600)

    original_clock = settings.clock
    settings.clock = crossing_clock
    try:
        assert admin.call(path, config, "PUT").status_code == 401
        assert len(reads) >= 3
    finally:
        settings.clock = original_clock
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT version FROM factories WHERE id=?", (a["id"],)).fetchone()[0] == config["version"]


@pytest.mark.parametrize("action", ["own-password", "platform-reset", "disable"])
def test_account_changes_revoke_old_and_page_manager_sessions(env, action):
    app, admin, (a, _), database, clock, _ = env
    owner = Client(app, True).login("alpha", "test-factory-only")
    token = owner.client.cookies.get(MANAGER_COOKIE)
    current = session_row(database, token)
    with sqlite3.connect(database) as con:
        con.execute("INSERT INTO sessions VALUES (?,?,?,?,?)",
                    (digest("synthetic-old-manager"), "old-csrf", "manager", current["subject"], clock[0] + 8 * 3600))
    if action == "own-password":
        response = owner.call("/password", dict(currentPassword="test-factory-only", password="updated-fixture", confirmation="updated-fixture"))
    elif action == "platform-reset":
        response = admin.call(f"/factories/{a['id']}/password", dict(password="updated-fixture", confirmation="updated-fixture"))
    else:
        response = permissions(admin, a, enabled=False)
    assert response.status_code == 200
    assert session_row(database, token) is None
    assert session_row(database, "synthetic-old-manager") is None
    assert owner.get("/factories").status_code == 401
