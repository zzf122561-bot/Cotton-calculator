"""Isolated factory product API. No migration, startup seeding or bundled credentials."""
from contextlib import closing, contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Literal
import csv
import io
import json
import os
import re
import secrets
import sqlite3
import tempfile
import uuid

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, FileResponse
from pydantic import Field

from machine_api import Body, Settings, credential, validate_credential, verify, digest
from factory_domain import (PARAMETERS, DEFAULT_PARAMETERS, PUBLIC_FIELDS, default_template,
                            validate_parameters, validate_template, calculate, render_share)

PREFIX = "/v2/factory-api"
GENERATION = "factory-contact-only-20261115"
VISITOR_COOKIE = "cotton_factory_contact_visitor"
MANAGER_COOKIE = "cotton_factory_contact_manager"
VISITOR_TTL = 180 * 86400
MANAGER_TTL = 3600
MANAGER_KIND = "manager-page-v1"
VISITOR_ANONYMOUS_TTL = 8 * 3600

SCHEMA = """
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE defaults(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,parameters TEXT NOT NULL,template TEXT NOT NULL);
CREATE TABLE factories(id TEXT PRIMARY KEY,name TEXT NOT NULL,enabled INTEGER NOT NULL,code TEXT UNIQUE NOT NULL,
 version INTEGER NOT NULL,parameters TEXT NOT NULL,template TEXT NOT NULL,editable TEXT NOT NULL,share_editable INTEGER NOT NULL);
CREATE TABLE accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL,
 factory_id TEXT UNIQUE REFERENCES factories(id),password TEXT NOT NULL);
CREATE TABLE visitors(id TEXT PRIMARY KEY,factory_id TEXT NOT NULL REFERENCES factories(id),generation INTEGER NOT NULL,revision INTEGER NOT NULL);
CREATE TABLE contacts(factory_id TEXT NOT NULL REFERENCES factories(id),phone TEXT NOT NULL,created REAL NOT NULL,
 PRIMARY KEY(factory_id,phone));
CREATE TABLE sessions(token TEXT PRIMARY KEY,csrf TEXT NOT NULL,kind TEXT NOT NULL,subject TEXT,expires REAL NOT NULL);
CREATE TABLE attempts(scope TEXT PRIMARY KEY,failures INTEGER NOT NULL,until REAL NOT NULL);
CREATE TABLE limits(scope TEXT PRIMARY KEY,count INTEGER NOT NULL,until REAL NOT NULL);
"""


def uid():
    return uuid.uuid4().hex


def pack(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def name(value):
    value = value.strip()
    if not value or len(value) > 60 or any(ord(char) < 32 for char in value):
        raise HTTPException(422, "名称不能为空或包含控制字符")
    return value


def username(value):
    value = value.strip().casefold()
    if not re.fullmatch(r"[a-z0-9_.-]{3,40}", value):
        raise HTTPException(422, "账号使用 3 至 40 位英文字母、数字、点、横线或下划线")
    return value


def initialize_factory_database(database: Path, admin_name: str, admin_credential: dict):
    """Explicit initializer using administrator-owned hashed material; never overwrites."""
    if database.exists():
        raise ValueError("Existing database; initialization refused")
    admin_name = username(admin_name)
    validate_credential(admin_credential)
    database.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="factory-init-", dir=database.parent) as folder:
        candidate = Path(folder) / "factory.sqlite3"
        with closing(sqlite3.connect(candidate)) as con, con:
            con.executescript(SCHEMA)
            con.execute("INSERT INTO meta VALUES ('generation',?)", (GENERATION,))
            con.execute("INSERT INTO defaults VALUES (1,1,?,?)", (pack(DEFAULT_PARAMETERS), pack(default_template())))
            con.execute("INSERT INTO accounts VALUES (?,?, 'platform',NULL,?)", (uid(), admin_name, pack(admin_credential)))
        os.link(candidate, database)


class Login(Body):
    username: str = Field(min_length=1, max_length=40)
    password: str = Field(min_length=1, max_length=128)


class Code(Body):
    code: str = Field(pattern=r"^\d{8}$")


class Join(Code):
    phone: str = Field(pattern=r"^1[0-9]{10}$")


class FactoryCreate(Body):
    name: str = Field(min_length=1, max_length=60)
    username: str = Field(min_length=3, max_length=40)
    password: str = Field(min_length=8, max_length=128)
    confirmation: str = Field(min_length=8, max_length=128)


class FactoryUpdate(Body):
    version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=60)
    enabled: bool
    editable: list[str]
    shareEditable: bool


class Config(Body):
    version: int = Field(ge=1)
    parameters: dict
    template: list


class PasswordChange(Body):
    password: str = Field(min_length=8, max_length=128)
    confirmation: str = Field(min_length=8, max_length=128)
    currentPassword: str = Field(default="", max_length=128)


class Calculation(Body):
    generation: int = Field(ge=1)
    revision: int = Field(ge=1, le=2**53-1)
    anchor: Literal["seed", "futures"]
    seedCottonPrice: str = Field(default="", max_length=24)
    futuresPrice: str = Field(default="", max_length=24)
    basisPrice: str = Field(max_length=24)


def create_factory_app(settings: Settings, assets: Path | None = None):
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @contextmanager
    def db():
        if not settings.database.is_file():
            raise HTTPException(503, "服务尚未初始化")
        con = sqlite3.connect(settings.database.resolve().as_uri() + "?mode=rw", uri=True, timeout=15)
        con.row_factory = sqlite3.Row
        try:
            generation = con.execute("SELECT value FROM meta WHERE key='generation'").fetchone()
            if not generation or generation[0] != GENERATION:
                raise HTTPException(503, "数据库不属于当前产品")
            con.execute("PRAGMA foreign_keys=ON")
            con.execute("BEGIN IMMEDIATE")
            try:
                yield con
            except HTTPException:
                con.commit()  # Failed authentication counters persist; mutations validate first.
                raise
            except BaseException:
                con.rollback()
                raise
            else:
                con.commit()
        except sqlite3.Error:
            raise HTTPException(503, "数据服务暂不可用，请稍后重试") from None
        finally:
            con.close()

    def cookie_name(request):
        return MANAGER_COOKIE if request.url.path.startswith(PREFIX + "/manage/") else VISITOR_COOKIE

    def session(con, request):
        token = request.cookies.get(cookie_name(request), "")
        row = con.execute("SELECT * FROM sessions WHERE token=? AND expires>?", (digest(token), settings.clock())).fetchone()
        kinds = {"anonymous", MANAGER_KIND} if cookie_name(request) == MANAGER_COOKIE else {"anonymous", "visitor"}
        if not row or row["kind"] not in kinds:
            raise HTTPException(401, "登录状态已失效，请重新进入")
        return row

    def manager_session(con, request):
        current = session(con, request)
        proof = request.headers.get("x-page-proof", "")
        if current["kind"] != MANAGER_KIND or not proof or not secrets.compare_digest(current["csrf"], digest(proof)):
            raise HTTPException(401, "登录状态已失效，请重新进入")
        return current

    def issue(con, response, cookie, kind="anonymous", subject=None, old=None):
        if old:
            con.execute("DELETE FROM sessions WHERE token=?", (old,))
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(24)
        ttl = MANAGER_TTL if cookie == MANAGER_COOKIE else (VISITOR_TTL if kind == "visitor" else VISITOR_ANONYMOUS_TTL)
        stored_csrf = digest(csrf) if kind == MANAGER_KIND else csrf
        con.execute("INSERT INTO sessions VALUES (?,?,?,?,?)", (digest(token), stored_csrf, kind, subject, settings.clock() + ttl))
        cookie_options = {} if cookie == MANAGER_COOKIE else {"max_age": ttl}
        response.set_cookie(cookie, token, **cookie_options, httponly=True, secure=settings.secure_cookie,
                            samesite="strict", path=PREFIX)
        return csrf

    def manager(con, request, platform=False):
        # Recheck the proof and absolute expiry inside each handler transaction.
        current = manager_session(con, request)
        row = con.execute("SELECT * FROM accounts WHERE id=?", (current["subject"],)).fetchone()
        if not row:
            raise HTTPException(401, "登录状态已失效，请重新进入")
        if platform and row["role"] != "platform":
            raise HTTPException(403, "没有管理权限")
        if row["factory_id"]:
            factory(con, row["factory_id"], active=True)
        return row

    def factory(con, factory_id, active=False):
        row = con.execute("SELECT * FROM factories WHERE id=?", (factory_id,)).fetchone()
        if not row:
            raise HTTPException(404, "加工厂不存在")
        if active and not row["enabled"]:
            raise HTTPException(403, "该加工厂已停用，请联系本厂")
        return row

    def managed_factory(con, request, factory_id, platform=False):
        account = manager(con, request, platform)
        if account["role"] != "platform" and account["factory_id"] != factory_id:
            raise HTTPException(403, "只能管理本厂")
        return account, factory(con, factory_id)

    def visitor(con, request, active=True):
        current = session(con, request)
        row = con.execute("SELECT * FROM visitors WHERE id=?", (current["subject"],)).fetchone() if current["kind"] == "visitor" else None
        if not row:
            raise HTTPException(403, "请先输入厂码进入")
        return row, factory(con, row["factory_id"], active)

    def throttle(con, scope, maximum):
        now = settings.clock()
        row = con.execute("SELECT * FROM limits WHERE scope=?", (scope,)).fetchone()
        if row and row["until"] > now:
            if row["count"] >= maximum:
                raise HTTPException(429, "操作频繁，请稍后重试", headers={"Retry-After": "60"})
            con.execute("UPDATE limits SET count=count+1 WHERE scope=?", (scope,))
        else:
            con.execute("INSERT OR REPLACE INTO limits VALUES (?,1,?)", (scope, now + 60))

    @app.middleware("http")
    async def boundary(request, call_next):
        try:
            if request.headers.get("host") != settings.origin.split("://", 1)[1]:
                raise HTTPException(403, "请求来源不正确")
            if request.url.path.startswith(PREFIX):
                if request.method not in {"GET", "HEAD"}:
                    if request.headers.get("origin") != settings.origin:
                        raise HTTPException(403, "请求来源不正确")
                    if request.headers.get("content-type", "").split(";")[0] != "application/json":
                        raise HTTPException(415, "请使用 JSON 请求")
                    if len(await request.body()) > 65536:
                        raise HTTPException(413, "请求内容过大")
                with db() as con:
                    address = request.client.host if request.client else "unknown"
                    throttle(con, "request:" + address, settings.request_limit)
                    protected_manager = cookie_name(request) == MANAGER_COOKIE and request.url.path not in {
                        PREFIX + "/manage/session", PREFIX + "/manage/login"}
                    current = manager_session(con, request) if protected_manager else None
                    if request.method not in {"GET", "HEAD"}:
                        current = current or session(con, request)
                        supplied_csrf = request.headers.get("x-csrf-token", "")
                        expected_csrf = digest(supplied_csrf) if current["kind"] == MANAGER_KIND else supplied_csrf
                        if not secrets.compare_digest(current["csrf"], expected_csrf):
                            raise HTTPException(403, "页面验证失效，请刷新后重试")
                        if request.url.path.endswith(("/login", "/code", "/join", "/password")):
                            throttle(con, "auth:" + address, settings.auth_limit)
            response = await call_next(request)
        except HTTPException as error:
            response = JSONResponse({"detail": error.detail}, status_code=error.status_code, headers=error.headers)
        response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                 "Referrer-Policy": "same-origin", "X-Frame-Options": "DENY",
                                 "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, error):
        return JSONResponse({"detail": "填写内容格式不正确，请检查后重试"}, status_code=422)

    @app.get(PREFIX + "/healthz")
    def health():
        return {"status": "ready"}

    @app.get(PREFIX + "/session")
    @app.get(PREFIX + "/manage/session")
    def get_session(request: Request, response: Response):
        with db() as con:
            if cookie_name(request) == MANAGER_COOKIE:
                # A new document cannot restore page authority from its cookie.
                # Do not revoke a visitor if its token was put in this cookie.
                token = digest(request.cookies.get(MANAGER_COOKIE, ""))
                con.execute("DELETE FROM sessions WHERE token=? AND kind IN ('anonymous','manager',?)", (token, MANAGER_KIND))
                return {"csrf": issue(con, response, MANAGER_COOKIE), "identity": None}
            con.execute("DELETE FROM sessions WHERE expires<=?", (settings.clock(),))
            con.execute("DELETE FROM limits WHERE until<=?", (settings.clock(),))
            try:
                current = session(con, request)
            except HTTPException:
                return {"csrf": issue(con, response, cookie_name(request)), "identity": None}
            identity = None
            if current["kind"] == "visitor":
                person, plant = visitor(con, request, False)
                identity = {"role": "visitor", "factoryId": plant["id"], "factoryName": plant["name"],
                            "enabled": bool(plant["enabled"]), "generation": person["generation"]}
                con.execute("UPDATE sessions SET expires=? WHERE token=?", (settings.clock() + VISITOR_TTL, current["token"]))
                response.set_cookie(VISITOR_COOKIE, request.cookies[VISITOR_COOKIE], max_age=VISITOR_TTL,
                                    httponly=True, secure=settings.secure_cookie, samesite="strict", path=PREFIX)
            return {"csrf": current["csrf"], "identity": identity}

    @app.post(PREFIX + "/logout")
    @app.post(PREFIX + "/manage/logout")
    def logout(request: Request, response: Response):
        with db() as con:
            current = manager_session(con, request) if cookie_name(request) == MANAGER_COOKIE else session(con, request)
            con.execute("DELETE FROM sessions WHERE token=?", (current["token"],))
        response.delete_cookie(cookie_name(request), path=PREFIX)
        return {"ok": True}

    @app.post(PREFIX + "/manage/login")
    def login(body: Login, request: Request, response: Response):
        with db() as con:
            current = session(con, request)
            if current["kind"] != "anonymous":
                raise HTTPException(401, "登录状态已失效，请重新进入")
            key = "login:" + body.username.strip().casefold()
            attempt = con.execute("SELECT * FROM attempts WHERE scope=?", (key,)).fetchone()
            if attempt and attempt["until"] > settings.clock():
                raise HTTPException(429, "连续失败，请 30 秒后重试", headers={"Retry-After": "30"})
            account = con.execute("SELECT * FROM accounts WHERE username=?", (body.username.strip().casefold(),)).fetchone()
            if not account or not verify(body.password, account["password"]):
                failures = (attempt["failures"] if attempt else 0) + 1
                con.execute("INSERT OR REPLACE INTO attempts VALUES (?,?,?)", (key, failures % 5,
                            settings.clock() + 30 if failures >= 5 else 0))
                raise HTTPException(401, "账号或密码不正确")
            if account["factory_id"]:
                factory(con, account["factory_id"], True)
            con.execute("DELETE FROM attempts WHERE scope=?", (key,))
            return {"csrf": issue(con, response, MANAGER_COOKIE, MANAGER_KIND, account["id"], current["token"]),
                    "identity": {"role": account["role"], "username": account["username"], "factoryId": account["factory_id"]},
                    "expiresIn": MANAGER_TTL}

    def password_value(body):
        if body.password != body.confirmation:
            raise HTTPException(422, "两次密码输入不一致")
        return pack(credential(body.password))

    @app.post(PREFIX + "/manage/password")
    def own_password(body: PasswordChange, request: Request):
        with db() as con:
            account = manager(con, request)
            if not verify(body.currentPassword, account["password"]):
                raise HTTPException(403, "原密码不正确")
            encoded = password_value(body)
            con.execute("UPDATE accounts SET password=? WHERE id=?", (encoded, account["id"]))
            con.execute("DELETE FROM sessions WHERE kind IN ('manager',?) AND subject=?", (MANAGER_KIND, account["id"]))
            return {"ok": True}

    def factory_view(con, row):
        account = con.execute("SELECT username FROM accounts WHERE factory_id=?", (row["id"],)).fetchone()
        return {"id": row["id"], "name": row["name"], "enabled": bool(row["enabled"]), "code": row["code"],
                "version": row["version"], "username": account[0], "editable": json.loads(row["editable"]),
                "shareEditable": bool(row["share_editable"])}

    def new_code(con):
        while True:
            code = str(secrets.randbelow(90_000_000) + 10_000_000)
            if not con.execute("SELECT 1 FROM factories WHERE code=?", (code,)).fetchone():
                return code

    @app.get(PREFIX + "/manage/factories")
    def factories(request: Request):
        with db() as con:
            account = manager(con, request)
            rows = con.execute("SELECT * FROM factories ORDER BY rowid") if account["role"] == "platform" else con.execute("SELECT * FROM factories WHERE id=?", (account["factory_id"],))
            return {"factories": [factory_view(con, row) for row in rows]}

    @app.post(PREFIX + "/manage/factories", status_code=201)
    def create_factory(body: FactoryCreate, request: Request):
        with db() as con:
            manager(con, request, True)
            login_name, plant_name = username(body.username), name(body.name)
            if con.execute("SELECT 1 FROM accounts WHERE username=?", (login_name,)).fetchone():
                raise HTTPException(409, "管理账号已存在")
            encoded = password_value(body)
            defaults = con.execute("SELECT * FROM defaults WHERE id=1").fetchone()
            factory_id = uid()
            con.execute("INSERT INTO factories VALUES (?,?,1,?,1,?,?,?,0)",
                        (factory_id, plant_name, new_code(con), defaults["parameters"], defaults["template"], "[]"))
            con.execute("INSERT INTO accounts VALUES (?,?, 'factory',?,?)", (uid(), login_name, factory_id, encoded))
            return factory_view(con, factory(con, factory_id))

    @app.patch(PREFIX + "/manage/factories/{factory_id}")
    def update_factory(factory_id: str, body: FactoryUpdate, request: Request):
        with db() as con:
            _, plant = managed_factory(con, request, factory_id, True)
            if body.version != plant["version"]:
                raise HTTPException(409, "配置已更新，请重载后再修改")
            if len(set(body.editable)) != len(body.editable) or not set(body.editable) <= set(PARAMETERS):
                raise HTTPException(422, "可编辑项目不正确")
            plant_name = name(body.name)
            con.execute("UPDATE factories SET name=?,enabled=?,editable=?,share_editable=?,version=version+1 WHERE id=?",
                        (plant_name, body.enabled, pack(body.editable), body.shareEditable, factory_id))
            if not body.enabled:
                con.execute("DELETE FROM sessions WHERE kind IN ('manager',?) AND subject IN (SELECT id FROM accounts WHERE factory_id=?)", (MANAGER_KIND, factory_id))
            return factory_view(con, factory(con, factory_id))

    @app.post(PREFIX + "/manage/factories/{factory_id}/rotate-code")
    def rotate_code(factory_id: str, request: Request):
        with db() as con:
            managed_factory(con, request, factory_id, True)
            con.execute("UPDATE factories SET code=? WHERE id=?", (new_code(con), factory_id))
            return factory_view(con, factory(con, factory_id))

    @app.post(PREFIX + "/manage/factories/{factory_id}/password")
    def reset_password(factory_id: str, body: PasswordChange, request: Request):
        with db() as con:
            managed_factory(con, request, factory_id, True)
            encoded = password_value(body)
            account = con.execute("SELECT id FROM accounts WHERE factory_id=?", (factory_id,)).fetchone()[0]
            con.execute("UPDATE accounts SET password=? WHERE id=?", (encoded, account))
            con.execute("DELETE FROM sessions WHERE kind IN ('manager',?) AND subject=?", (MANAGER_KIND, account))
            return {"ok": True}

    def config_view(row):
        return {"version": row["version"], "parameters": json.loads(row["parameters"]), "template": json.loads(row["template"])}

    def config_row(con, request, factory_id):
        if factory_id == "defaults":
            return manager(con, request, True), con.execute("SELECT * FROM defaults WHERE id=1").fetchone()
        return managed_factory(con, request, factory_id)

    def checked_config(con, request, factory_id, body):
        account, row = config_row(con, request, factory_id)
        if body.version != row["version"]:
            raise HTTPException(409, "配置已更新，请重载后再发布")
        parameters, template = validate_parameters(body.parameters), validate_template(body.template)
        if account["role"] != "platform":
            previous = config_view(row)
            allowed = set(json.loads(row["editable"]))
            if any(parameters[key] != previous["parameters"][key] for key in PARAMETERS if key not in allowed):
                raise HTTPException(403, "包含未获授权的参数修改")
            if not row["share_editable"] and template != previous["template"]:
                raise HTTPException(403, "尚未开放分享文案编辑权限")
        return parameters, template

    @app.get(PREFIX + "/manage/config/{factory_id}")
    def get_config(factory_id: str, request: Request):
        with db() as con:
            _, row = config_row(con, request, factory_id)
            return config_view(row)

    @app.post(PREFIX + "/manage/config/{factory_id}/preview")
    def preview_config(factory_id: str, body: Config, request: Request):
        with db() as con:
            parameters, template = checked_config(con, request, factory_id, body)
            result = calculate(parameters, {"anchor": "futures", **parameters})
            return {**result, "shareText": render_share(template, result, date_text(settings.clock()))}

    @app.put(PREFIX + "/manage/config/{factory_id}")
    def publish_config(factory_id: str, body: Config, request: Request):
        with db() as con:
            parameters, template = checked_config(con, request, factory_id, body)
            if factory_id == "defaults":
                con.execute("UPDATE defaults SET parameters=?,template=?,version=version+1 WHERE id=1", (pack(parameters), pack(template)))
            else:
                con.execute("UPDATE factories SET parameters=?,template=?,version=version+1 WHERE id=?", (pack(parameters), pack(template), factory_id))
            _, row = config_row(con, request, factory_id)
            return config_view(row)

    def by_code(con, code):
        row = con.execute("SELECT * FROM factories WHERE code=? AND enabled=1", (code,)).fetchone()
        if not row:
            raise HTTPException(404, "厂码无效或加工厂已停用")
        return row

    @app.post(PREFIX + "/code")
    def lookup_code(body: Code):
        with db() as con:
            plant = by_code(con, body.code)
            return {"name": plant["name"]}

    @app.post(PREFIX + "/join")
    def join(body: Join, request: Request, response: Response):
        with db() as con:
            current = session(con, request)
            plant = by_code(con, body.code)
            now = settings.clock()
            if current["kind"] == "visitor":
                person, _ = visitor(con, request, False)
                person_id = person["id"]
                if person["factory_id"] != plant["id"]:
                    raise HTTPException(403, "当前访问身份已绑定加工厂，不能自行更换")
            else:
                person_id = uid()
                con.execute("INSERT INTO visitors VALUES (?,?,1,0)", (person_id, plant["id"]))
            # Contact collection has no visitor, session or calculation identifier.
            con.execute("INSERT OR IGNORE INTO contacts VALUES (?,?,?)", (plant["id"], body.phone, now))
            return {"csrf": issue(con, response, VISITOR_COOKIE, "visitor", person_id, current["token"])}

    @app.get(PREFIX + "/context")
    def context(request: Request):
        with db() as con:
            person, plant = visitor(con, request, False)
            parameters = json.loads(plant["parameters"])
            inputs = {"anchor": "futures", "seedCottonPrice": "",
                        "futuresPrice": parameters["futuresPrice"], "basisPrice": parameters["basisPrice"]}
            return {"factory": {"id": plant["id"], "name": plant["name"], "enabled": bool(plant["enabled"])},
                    "generation": person["generation"], "revision": person["revision"],
                    "configVersion": plant["version"], "inputs": inputs}

    @app.post(PREFIX + "/calculate")
    def compute(body: Calculation, request: Request):
        with db() as con:
            person, plant = visitor(con, request)
            if body.generation != person["generation"]:
                raise HTTPException(409, "访问状态已变化，请刷新后重试")
            if body.revision <= person["revision"]:
                raise HTTPException(409, "另一个页面已更新测算，请刷新后继续")
            inputs = body.model_dump(exclude={"generation", "revision"})
            parameters = json.loads(plant["parameters"])
            result = calculate(parameters, inputs)
            # Return coherent visible prices; never persist inputs or results.
            derived = "futuresPrice" if body.anchor == "seed" else "seedCottonPrice"
            inputs[derived] = result["prices"][derived]
            now, calculation_id = settings.clock(), uid()
            share = render_share(json.loads(plant["template"]), result, date_text(now))
            public = {**result, "id": calculation_id, "factoryId": plant["id"], "configVersion": plant["version"],
                      "created": now, "inputs": inputs, "shareText": share}
            con.execute("UPDATE visitors SET revision=? WHERE id=?", (body.revision, person["id"]))
            return public

    @app.get(PREFIX + "/manage/factories/{factory_id}/contacts")
    def contacts(factory_id: str, request: Request):
        with db() as con:
            managed_factory(con, request, factory_id)
            rows = con.execute("SELECT phone,created FROM contacts WHERE factory_id=? ORDER BY created DESC,phone", (factory_id,))
            return {"contacts": [{**dict(row), "phoneVerified": False} for row in rows]}

    @app.get(PREFIX + "/manage/factories/{factory_id}/contacts.csv")
    def export_contacts(factory_id: str, request: Request):
        with db() as con:
            managed_factory(con, request, factory_id)
            rows = con.execute("SELECT phone,created FROM contacts WHERE factory_id=? ORDER BY created DESC,phone", (factory_id,))
            output = io.StringIO(newline="")
            writer = csv.writer(output)
            writer.writerow(["手机号", "收集时间", "核验状态"])
            for row in rows:
                writer.writerow([row["phone"], date_text(row["created"]), "未核验"])
            return Response("\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8",
                            headers={"Content-Disposition": 'attachment; filename="factory-contacts.csv"'})

    if assets:
        allowed = {"index.html": "text/html", "manage.html": "text/html", "style.css": "text/css",
                   "farmer.js": "application/javascript", "manage.js": "application/javascript", "shared.js": "application/javascript",
                   "comparison.js": "application/javascript", "management-session.js": "application/javascript",
                   "access-control.js": "application/javascript", "cotton-boll.png": "image/png"}

        @app.get("/v2/factory/")
        def index():
            return FileResponse(assets / "index.html", media_type="text/html")

        @app.get("/v2/factory/{filename}")
        def asset(filename: str):
            if filename not in allowed:
                raise HTTPException(404)
            path = {"access-control.js": assets.parent / "js" / filename,
                    "cotton-boll.png": assets.parent / "assets" / filename}.get(filename, assets / filename)
            return FileResponse(path, media_type=allowed[filename])

    return app


def date_text(timestamp):
    return datetime.fromtimestamp(timestamp, timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M")
