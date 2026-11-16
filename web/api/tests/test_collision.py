"""Approved cross-level boundary: synthetic passwords only, real SQLite transactions."""
from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
from threading import Barrier
import pytest
from machine_api import create_app, verify
from test_api import ADMIN, DOOR, LEVEL1, Browser, hashes, system, replacement

DETAIL = "新密码与其他权限层级冲突，请使用不同密码"


def business(settings):
    with sqlite3.connect(settings.database) as con:
        return tuple(con.execute(query).fetchall() for query in (
            "SELECT * FROM users ORDER BY id", "SELECT * FROM configs ORDER BY user_id",
            "SELECT * FROM meta ORDER BY key", "SELECT * FROM sessions ORDER BY id", "SELECT * FROM elevations ORDER BY id"))


@pytest.mark.parametrize("kind", ["door", "settings"])
def test_create_rejects_only_admin_collision_without_partial_write(system, kind):
    app, settings, _ = system
    admin = Browser(app); admin.unlock(ADMIN)
    before = business(settings)
    body = dict(name="不可部分创建", doorPassword=DOOR, doorConfirmation=DOOR,
                settingsPassword=LEVEL1, settingsConfirmation=LEVEL1)
    body[kind + "Password"] = body[kind + "Confirmation"] = ADMIN
    response = admin.write("POST", "/admin/users", body)
    assert response.status_code == 422 and response.json()["detail"] == DETAIL
    assert business(settings) == before
    assert admin.get("/admin/users").status_code == 200
    assert admin.add("仍允许普通重复").status_code == 201


@pytest.mark.parametrize("kind,current", [("door", DOOR), ("settings", LEVEL1)])
def test_own_change_checks_old_first_and_keeps_credentials_elevation_on_conflict(system, kind, current):
    app, settings, _ = system
    user = Browser(app); user.login(); user.unlock()
    assert user.write("POST", f"/me/password/{kind}", replacement("wrong-old", ADMIN)).status_code == 401
    before = business(settings)
    response = user.write("POST", f"/me/password/{kind}", replacement(current, ADMIN))
    assert response.status_code == 422 and response.json()["detail"] == DETAIL
    assert business(settings) == before
    assert user.write("PUT", "/me/config", user.get("/me/config").json()).status_code == 200
    fresh = Browser(create_app(settings)); assert fresh.login().status_code == 200
    assert fresh.unlock().json()["role"] == "settings"


@pytest.mark.parametrize("kind", ["door", "settings"])
def test_admin_reset_rejection_needs_no_target_old_and_does_not_revoke(system, kind):
    app, settings, _ = system
    user, admin = Browser(app), Browser(app)
    uid = user.login().json()["user"]["id"]; user.unlock(); admin.unlock(ADMIN)
    before = business(settings)
    body = dict(newPassword=ADMIN, confirmation=ADMIN)
    response = admin.write("POST", f"/admin/users/{uid}/password/{kind}", body)
    assert response.status_code == 422 and response.json()["detail"] == DETAIL
    assert business(settings) == before
    assert user.write("PUT", "/me/config", user.get("/me/config").json()).status_code == 200
    assert admin.get("/admin/users").status_code == 200


@pytest.mark.parametrize("password", [DOOR, LEVEL1])
def test_admin_change_rejects_both_credentials_of_disabled_users_until_deleted(system, password):
    app, settings, _ = system
    admin = Browser(app); admin.unlock(ADMIN)
    # Wrong own old password takes precedence over the collision message.
    assert admin.write("POST", "/admin/password", replacement("wrong-old", password)).status_code == 401
    uid = admin.get("/users").json()[0]["id"]
    admin.write("PATCH", f"/admin/users/{uid}", dict(enabled=False))
    before = business(settings)
    response = admin.write("POST", "/admin/password", replacement(ADMIN, password))
    assert response.status_code == 422 and response.json()["detail"] == DETAIL
    assert business(settings) == before and admin.get("/admin/users").status_code == 200
    admin.write("DELETE", f"/admin/users/{uid}")
    assert admin.write("POST", "/admin/password", replacement(ADMIN, password)).status_code == 200
    fresh = Browser(create_app(settings)); assert fresh.unlock(password).json()["role"] == "admin"


def test_case_sensitive_admin_boundary_and_same_user_same_password_are_allowed(system):
    app, _, _ = system
    user, admin = Browser(app), Browser(app)
    uid = user.login().json()["user"]["id"]; user.unlock(); admin.unlock(ADMIN)
    # Own door and settings may match; they still route only under selected UUID.
    assert user.write("POST", "/me/password/settings", replacement(LEVEL1, DOOR)).status_code == 200
    other = admin.add("普通同密码").json()["id"]
    assert other != uid
    fresh = Browser(app); fresh.login(uid); assert fresh.unlock(DOOR).json()["role"] == "settings"
    assert admin.write("POST", "/admin/password", replacement(ADMIN, DOOR.upper())).status_code == 200
    fresh_admin = Browser(app); assert fresh_admin.unlock(DOOR.upper()).json()["role"] == "admin"
    assert fresh_admin.write("POST", f"/admin/users/{other}/password/door", dict(newPassword=DOOR, confirmation=DOOR)).status_code == 200
    # Unprivileged requests cannot use collision output as a password oracle.
    anonymous = Browser(app)
    assert anonymous.write("POST", "/admin/password", replacement(ADMIN, DOOR)).status_code == 403


def test_concurrent_admin_and_user_changes_to_same_password_serialize(system):
    app, settings, _ = system
    user, admin = Browser(app), Browser(app)
    uid = user.login().json()["user"]["id"]; user.unlock(); admin.unlock(ADMIN)
    barrier = Barrier(2); candidate = "transaction-race-fixture"
    def own():
        barrier.wait(); return user.write("POST", "/me/password/door", replacement(DOOR, candidate))
    def elevated():
        barrier.wait(); return admin.write("POST", "/admin/password", replacement(ADMIN, candidate))
    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = pool.submit(own), pool.submit(elevated)
        responses = [first.result(timeout=20), second.result(timeout=20)]
    assert sorted(response.status_code for response in responses) == [200, 422]
    assert next(response.json()["detail"] for response in responses if response.status_code == 422) == DETAIL
    with sqlite3.connect(settings.database) as con:
        door = con.execute("SELECT door FROM users WHERE id=?", (uid,)).fetchone()[0]
        admin_credential = con.execute("SELECT value FROM meta WHERE key='admin'").fetchone()[0]
    assert verify(candidate, door) != verify(candidate, admin_credential)
    assert verify(DOOR, door) != verify(ADMIN, admin_credential)
