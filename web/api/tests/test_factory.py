"""Synthetic business and authorization coverage for the independent factory product."""
from copy import deepcopy
from fractions import Fraction
from pathlib import Path
import json
import csv
import io
import sqlite3
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from machine_api import Settings, credential, digest
from factory_api import create_factory_app, initialize_factory_database, PREFIX, VISITOR_COOKIE, VISITOR_TTL
from factory_domain import DEFAULT_PARAMETERS, calculate, rounded, validate_parameters, default_template

ORIGIN = "http://127.0.0.1:4198"


class Client:
    def __init__(self, app, management=False):
        self.client = TestClient(app, base_url=ORIGIN)
        self.management = management
        self.proof = ""
        self.prefix = PREFIX + ("/manage" if management else "")
        self.csrf = self.get("/session").json()["csrf"]

    def get(self, path):
        response = self.client.get(self.prefix + path, headers={"X-Page-Proof": self.proof} if self.proof else {})
        if self.management and path == "/session" and response.status_code == 200:
            self.csrf, self.proof = response.json()["csrf"], ""
        return response

    def call(self, path, body=None, method="POST"):
        headers = {"Origin": ORIGIN, "X-CSRF-Token": self.csrf}
        if self.proof:
            headers["X-Page-Proof"] = self.proof
        response = self.client.request(method, self.prefix + path, json=body or {}, headers=headers)
        if response.status_code < 400 and "csrf" in response.json():
            self.csrf = response.json()["csrf"]
            if self.management and path == "/login":
                self.proof = self.csrf
        return response

    def login(self, username="platform", password="test-platform-only"):
        response = self.call("/login", dict(username=username, password=password))
        assert response.status_code == 200, response.text
        return self

    def join(self, code, phone="13800000000"):
        response = self.call("/join", dict(code=code, phone=phone))
        assert response.status_code == 200, response.text
        return self

    def calc(self, **values):
        context = self.get("/context").json()
        payload = dict(context["inputs"], generation=context["generation"], revision=context["revision"] + 1)
        payload.update(values)
        return self.call("/calculate", payload)


@pytest.fixture(scope="session")
def admin_hash():
    return credential("test-platform-only")


@pytest.fixture
def env(tmp_path, admin_hash):
    database = tmp_path / "factory.sqlite3"
    initialize_factory_database(database, "platform", admin_hash)
    clock = [2_000_000_000.0]
    settings = Settings(database, None, ORIGIN, secure_cookie=False, request_limit=10000, auth_limit=1000, clock=lambda: clock[0])
    app = create_factory_app(settings, Path(__file__).resolve().parents[2] / "factory")
    admin = Client(app, True).login()
    plants = []
    for name in ("alpha", "bravo"):
        response = admin.call("/factories", dict(name=name, username=name, password="test-factory-only", confirmation="test-factory-only"))
        assert response.status_code == 201, response.text
        plants.append(response.json())
    return app, admin, plants, database, clock, settings


def publish(admin, plant, change=None, template=None):
    path = "/config/" + plant["id"]
    config = admin.get(path).json()
    config["parameters"].update(change or {})
    if template is not None:
        config["template"] = template
    return admin.call(path, config, "PUT")


def permissions(admin, plant, **changes):
    current = next(item for item in admin.get("/factories").json()["factories"] if item["id"] == plant["id"])
    body = {key: current[key] for key in ("name", "version", "enabled", "editable", "shareEditable")}
    body.update(changes)
    return admin.call("/factories/" + plant["id"], body, "PATCH")


def test_exact_prices_and_fixed_basis():
    seed = calculate(DEFAULT_PARAMETERS, dict(anchor="seed", seedCottonPrice="7.3", basisPrice="1000"))
    assert seed["prices"] == dict(seedCottonPrice="7.30", futuresPrice="15987", basisPrice="1000", lintPrice="16987")
    assert seed["exactSeed"] == {"n": "73", "d": "10"}
    futures = calculate(DEFAULT_PARAMETERS, dict(anchor="futures", futuresPrice="15000", basisPrice="1000"))
    basis = calculate(DEFAULT_PARAMETERS, dict(anchor="futures", futuresPrice="15000", basisPrice="1200"))
    assert futures["prices"]["seedCottonPrice"] == "6.93"
    assert basis["prices"] == dict(seedCottonPrice="7.00", futuresPrice="15000", basisPrice="1200", lintPrice="16200")


@pytest.mark.parametrize("basis", ["-1000", "0", "1000"])
def test_signed_basis(basis):
    result = calculate(DEFAULT_PARAMETERS, dict(anchor="futures", futuresPrice="16000", basisPrice=basis))
    assert result["prices"]["basisPrice"] == basis
    assert int(result["prices"]["lintPrice"]) == 16000 + int(basis)


@pytest.mark.parametrize("value,expected", [(Fraction(1, 200), "0.01"), (Fraction(-1, 200), "-0.01"), (Fraction(1, 300), "0.00")])
def test_half_up(value, expected):
    assert rounded(value, 2) == expected


@pytest.mark.parametrize("change", [{"basisPrice": "-"}, {"basisPrice": "1.5"}, {"futuresPrice": ""}, {"futuresPrice": "-1"}, {"basisPrice": "-20000"}])
def test_invalid_price_does_not_create_result(change):
    with pytest.raises(Exception) as error:
        calculate(DEFAULT_PARAMETERS, {"anchor": "futures", "futuresPrice": "16000", "basisPrice": "1000", **change})
    assert error.value.status_code == 422


def test_phone_required_but_collected_without_browser_identity(env):
    app, admin, (a, b), database, *_ = env
    first = Client(app).join(a["code"])
    second = Client(app).join(a["code"])
    assert first.client.cookies.get(VISITOR_COOKIE) != second.client.cookies.get(VISITOR_COOKIE)
    contacts = admin.get(f"/factories/{a['id']}/contacts").json()["contacts"]
    assert len(contacts) == 1 and contacts[0]["phone"] == "13800000000"
    assert set(contacts[0]) == {"phone", "created", "phoneVerified"} and not contacts[0]["phoneVerified"]
    assert "phone" not in first.get("/session").json()["identity"]
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT COUNT(*) FROM visitors").fetchone()[0] == 2
        assert {r[1] for r in con.execute("PRAGMA table_info(visitors)")} == {"id", "factory_id", "generation", "revision"}
        assert {r[1] for r in con.execute("PRAGMA table_info(contacts)")} == {"factory_id", "phone", "created"}
    assert Client(app).call("/join", dict(code="00000000", phone="13800000000")).status_code == 404
    for value in ("", "abc", "=1+1", "1１２３４５６７８９０"):
        assert Client(app).call("/join", dict(code=a["code"], phone=value)).status_code == 422
    assert Client(app).call("/join", dict(code=a["code"])).status_code == 422


def test_contacts_export_is_scoped_to_receiving_factory(env):
    app, admin, (a, b), *_ = env
    Client(app).join(a["code"])
    Client(app).join(b["code"], "13900000000")
    owner_a = Client(app, True).login("alpha", "test-factory-only")
    owner_b = Client(app, True).login("bravo", "test-factory-only")
    for client, own, foreign, phone in [(owner_a, a, b, "13800000000"), (owner_b, b, a, "13900000000")]:
        data = client.get(f"/factories/{own['id']}/contacts").json()["contacts"]
        assert [item["phone"] for item in data] == [phone]
        export = client.get(f"/factories/{own['id']}/contacts.csv")
        assert export.status_code == 200 and export.content.startswith(b"\xef\xbb\xbf")
        assert "attachment" in export.headers["content-disposition"] and "no-store" in export.headers["cache-control"]
        rows = list(csv.reader(io.StringIO(export.content.decode("utf-8-sig"))))
        assert rows[0] == ["手机号", "收集时间", "核验状态"] and rows[1][0] == phone and rows[1][2] == "未核验"
        for suffix in ("contacts", "contacts.csv"):
            assert client.get(f"/factories/{foreign['id']}/{suffix}").status_code == 403
    stranger = Client(app, True)
    assert stranger.get(f"/factories/{a['id']}/contacts.csv").status_code == 401
    assert Client(app).join(b["code"]).get("/context").json()["factory"]["id"] == b["id"]


def test_existing_identity_cannot_switch_factory_or_submit_foreign_contact(env):
    app, admin, (a, b), database, *_ = env
    person = Client(app).join(a["code"])
    assert person.calc().status_code == 200
    previous_context = person.get("/context").json()
    previous_cookie, previous_csrf = person.client.cookies.get(VISITOR_COOKIE), person.csrf

    def persisted_access():
        with sqlite3.connect(database) as con:
            return {table: con.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
                    for table in ("visitors", "sessions", "contacts")}

    previous_access = persisted_access()
    rejected = person.call("/join", dict(code=b["code"], phone="13900000000"))
    assert rejected.status_code == 403 and "不能自行更换" in rejected.json()["detail"]
    assert "set-cookie" not in rejected.headers
    assert person.client.cookies.get(VISITOR_COOKIE) == previous_cookie and person.csrf == previous_csrf
    assert persisted_access() == previous_access
    assert person.get("/context").json() == previous_context
    assert admin.get(f"/factories/{b['id']}/contacts").json()["contacts"] == []
    assert person.calc().status_code == 200


def test_same_factory_reentry_preserves_identity_and_calculation_order(env):
    app, admin, (a, b), database, *_ = env
    person = Client(app).join(a["code"])
    assert person.calc().status_code == 200
    previous_context = person.get("/context").json()
    previous_cookie = person.client.cookies.get(VISITOR_COOKIE)
    with sqlite3.connect(database) as con:
        previous_visitor = con.execute("SELECT * FROM visitors").fetchall()
    person.join(a["code"])
    assert person.get("/context").json() == previous_context
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT * FROM visitors").fetchall() == previous_visitor
        assert con.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 1
        assert con.execute("SELECT 1 FROM sessions WHERE token=?", (digest(previous_cookie),)).fetchone() is None
    assert person.client.cookies.get(VISITOR_COOKIE) != previous_cookie
    assert person.calc().status_code == 200


def test_disabled_factory_identity_cannot_switch_but_new_identity_can_enter(env):
    app, admin, (a, b), *_ = env
    person = Client(app).join(a["code"])
    assert permissions(admin, a, enabled=False).status_code == 200
    rejected = person.call("/join", dict(code=b["code"], phone="13900000000"))
    assert rejected.status_code == 403
    assert person.get("/context").json()["factory"]["id"] == a["id"]
    stopped = person.calc()
    assert stopped.status_code == 403 and stopped.json()["detail"] == "该加工厂已停用，请联系本厂"
    assert admin.get(f"/factories/{b['id']}/contacts").json()["contacts"] == []
    fresh = Client(app).join(b["code"], "13900000000")
    assert fresh.get("/context").json()["factory"]["id"] == b["id"]
    assert fresh.calc().status_code == 200


def test_farmer_cannot_read_configuration_or_manager_routes(env):
    app, admin, (a, b), *_ = env
    person = Client(app).join(a["code"])
    manager_client = Client(app, True)
    assert manager_client.get(f"/config/{a['id']}").status_code == 401
    assert manager_client.get("/factories").status_code == 401
    result = person.calc().json()
    content = json.dumps([person.get("/context").json(), result])
    for key in ("lintPercentage", "lossPercentage", "cottonseedPrice", "processingFee", "parameters", "template", "password", "phone"):
        assert key not in content
    assert person.call("/calculate", dict(factoryId=b["id"])).status_code == 422


def test_permissions_preview_publish_version_conflicts(env):
    app, admin, (a, b), *_ = env
    owner = Client(app, True).login("alpha", "test-factory-only")
    path = f"/config/{a['id']}"
    config = owner.get(path).json(); config["parameters"]["processingFee"] = "1200"
    assert owner.call(path + "/preview", config).status_code == 403
    assert owner.call(path, config, "PUT").status_code == 403
    assert permissions(admin, a, editable=["processingFee"]).status_code == 200
    config = owner.get(path).json(); config["parameters"]["processingFee"] = "1200"
    assert owner.call(path + "/preview", config).status_code == 200
    assert owner.call(path, config, "PUT").status_code == 200
    assert owner.call(path, config, "PUT").status_code == 409
    assert owner.get(f"/config/{b['id']}").status_code == 403
    assert owner.get("/config/defaults").status_code == 403


def test_share_permissions_and_private_field_rejection(env):
    app, admin, (a, b), *_ = env
    owner = Client(app, True).login("alpha", "test-factory-only")
    path = f"/config/{a['id']}"
    config = owner.get(path).json(); config["template"][0]["text"] = "本厂报价"
    assert owner.call(path, config, "PUT").status_code == 403
    permissions(admin, a, shareEditable=True)
    config["version"] = owner.get(path).json()["version"]
    preview = owner.call(path + "/preview", config).json()
    assert owner.call(path, config, "PUT").status_code == 200
    person = Client(app).join(a["code"]); result = person.calc().json()
    assert result["shareText"] == preview["shareText"]
    config = owner.get(path).json(); config["template"][1]["key"] = "processingFee"
    assert owner.call(path, config, "PUT").status_code == 422


def test_no_calculation_history_or_legacy_plan_apis(env):
    app, admin, (a, b), database, *_ = env
    person = Client(app).join(a["code"])
    result = person.calc(basisPrice="-500").json()
    assert publish(admin, a, {"processingFee": "2000", "basisPrice": "1200"}).status_code == 200
    fresh = person.calc(basisPrice="-500").json()
    assert fresh["prices"]["basisPrice"] == "-500" and fresh["prices"] != result["prices"]
    # Defaults are returned on a new page; the browser alone retains in-page input.
    assert person.get("/context").json()["inputs"]["basisPrice"] == "1200"
    assert person.get("/plans").status_code == 404
    assert person.call("/plans", {"calculationId": result["id"]}).status_code == 404
    assert person.call("/comparison", {"ids": [result["id"]]}, "PUT").status_code == 404
    for path in (f"/factories/{a['id']}/customers", f"/factories/{a['id']}/customers/anything/plans"):
        assert admin.get(path).status_code == 404
    with sqlite3.connect(database) as con:
        tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert not tables.intersection({"drafts", "calculations", "plans", "comparisons"})
        assert con.execute("SELECT COUNT(*) FROM contacts").fetchone()[0] == 1


def test_out_of_order_and_stale_identity_generation_rejected(env):
    app, admin, (a, b), *_ = env
    person = Client(app).join(a["code"])
    payload = dict(generation=1, revision=20, anchor="futures", futuresPrice="16000", basisPrice="1000")
    assert person.call("/calculate", payload).status_code == 200
    payload["revision"] = 19
    assert person.call("/calculate", payload).status_code == 409
    payload.update(revision=21, generation=2)
    stale = person.call("/calculate", payload)
    assert stale.status_code == 409 and stale.json()["detail"] == "访问状态已变化，请刷新后重试"
    assert person.get("/context").json()["revision"] == 20


def test_response_has_coherent_prices_without_saved_draft(env):
    app, admin, (a, b), *_ = env
    person = Client(app).join(a["code"])
    result = person.calc(anchor="seed", seedCottonPrice="7.3", futuresPrice="1").json()
    assert result["inputs"]["seedCottonPrice"] == "7.3"
    assert result["inputs"]["futuresPrice"] == result["prices"]["futuresPrice"] == "15987"
    context = person.get("/context").json()
    assert context["inputs"]["seedCottonPrice"] == "" and context["revision"] == 1


def test_defaults_apply_only_to_new_factories(env):
    app, admin, (a, b), *_ = env
    before = admin.get(f"/config/{a['id']}").json()
    config = admin.get("/config/defaults").json(); config["parameters"]["basisPrice"] = "555"
    assert admin.call("/config/defaults", config, "PUT").status_code == 200
    assert admin.get(f"/config/{a['id']}").json() == before
    created = admin.call("/factories", dict(name="new", username="charlie", password="synthetic-only", confirmation="synthetic-only")).json()
    assert admin.get(f"/config/{created['id']}").json()["parameters"]["basisPrice"] == "555"


def test_code_rotation_disable_and_manager_password_reset(env):
    app, admin, (a, b), *_ = env
    person = Client(app).join(a["code"])
    owner = Client(app, True).login("alpha", "test-factory-only")
    rotated = admin.call(f"/factories/{a['id']}/rotate-code").json()
    assert rotated["code"] != a["code"]
    assert Client(app).call("/code", {"code": a["code"]}).status_code == 404
    assert person.calc().status_code == 200
    assert admin.call(f"/factories/{a['id']}/password", dict(password="changed-fixture", confirmation="changed-fixture")).status_code == 200
    assert owner.get("/factories").status_code == 401
    Client(app, True).login("alpha", "changed-fixture")
    assert permissions(admin, a, enabled=False).status_code == 200
    assert person.calc().status_code == 403
    assert person.get("/context").status_code == 200
    assert Client(app).call("/code", {"code": rotated["code"]}).status_code == 404


def test_expiry_hash_storage_and_restart_persistence(env):
    app, admin, (a, b), database, clock, settings = env
    person = Client(app).join(a["code"]); person.calc()
    raw = person.client.cookies.get(VISITOR_COOKIE)
    with sqlite3.connect(database) as con:
        assert con.execute("SELECT token FROM sessions WHERE token=?", (raw,)).fetchone() is None
        assert con.execute("SELECT token FROM sessions WHERE token=?", (digest(raw),)).fetchone()
    restarted = TestClient(create_factory_app(settings), base_url=ORIGIN)
    restarted.cookies.update(person.client.cookies)
    assert restarted.get(PREFIX + "/context").json()["factory"]["id"] == a["id"]
    clock[0] += VISITOR_TTL - 10
    assert person.get("/session").json()["identity"]["role"] == "visitor"
    clock[0] += 20
    assert person.get("/context").status_code == 200
    clock[0] += VISITOR_TTL + 1
    assert person.get("/session").json()["identity"] is None
    person.csrf = person.get("/session").json()["csrf"]
    person.join(a["code"])
    assert person.get("/context").json()["revision"] == 0


def test_origin_csrf_extra_fields_and_body_limit(env):
    app, admin, (a, b), *_ = env
    person = Client(app)
    url = PREFIX + "/code"
    assert person.client.post(url, json={"code": a["code"]}, headers={"Origin": ORIGIN}).status_code == 403
    assert person.client.post(url, json={"code": a["code"]}, headers={"Origin": "https://evil.example", "X-CSRF-Token": person.csrf}).status_code == 403
    assert person.call("/code", {"code": a["code"], "role": "platform"}).status_code == 422
    assert person.call("/code", {"code": "x" * 70000}).status_code == 413
    assert person.client.get(PREFIX + "/session", headers={"Host": "evil.example"}).status_code == 403


def test_login_cooldown_and_password_change(env):
    app, admin, (a, b), database, clock, settings = env
    client = Client(app, True)
    for _ in range(5):
        assert client.call("/login", dict(username="alpha", password="wrong")).status_code == 401
    assert client.call("/login", dict(username="alpha", password="test-factory-only")).status_code == 429
    clock[0] += 31
    client.login("alpha", "test-factory-only")
    assert client.call("/password", dict(currentPassword="wrong", password="new-fixture", confirmation="new-fixture")).status_code == 403
    assert client.call("/password", dict(currentPassword="test-factory-only", password="new-fixture", confirmation="new-fixture")).status_code == 200
    assert client.get("/factories").status_code == 401
    Client(app, True).login("alpha", "new-fixture")


@pytest.mark.parametrize("generation", ["machine-cloud-20261003", "factory-browser-identity-20261115"])
def test_initialization_never_overwrites_or_accepts_legacy_database(tmp_path, admin_hash, generation):
    database = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database) as con:
        con.execute("CREATE TABLE meta(key TEXT,value TEXT)")
        con.execute("INSERT INTO meta VALUES ('generation',?)", (generation,))
    original = database.read_bytes()
    with pytest.raises(ValueError):
        initialize_factory_database(database, "platform", admin_hash)
    app = create_factory_app(Settings(database, None, ORIGIN, secure_cookie=False))
    assert TestClient(app, base_url=ORIGIN).get(PREFIX + "/session").status_code == 503
    assert database.read_bytes() == original


def test_assets_whitelist_and_no_legacy_service_worker(env):
    app, *_ = env
    client = TestClient(app, base_url=ORIGIN)
    response = client.get("/v2/factory/")
    assert response.status_code == 200 and "factory-code" in response.text
    assert "serviceWorker.register" not in client.get("/v2/factory/farmer.js").text
    assert client.get("/v2/factory/factory_api.py").status_code == 404
    assert client.get("/v2/factory/cotton-boll.png").headers["content-type"] == "image/png"
    assert client.get("/v2/factory/comparison.js").status_code == 200
    assert client.get("/v2/factory/management-session.js").status_code == 200
    assert "class TenTapTrigger" in client.get("/v2/factory/access-control.js").text
    assert "厂方管理" not in response.text and "我保存的方案" not in response.text
    assert "no-store" in response.headers["cache-control"]
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
