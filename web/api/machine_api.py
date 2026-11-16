"""Machine derivative API. No bundled credentials or production data."""
from contextlib import contextmanager, closing
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Literal
from urllib.parse import urlsplit
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import tempfile
import uuid

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

PREFIX = "/v2/api"
GENERATION = "machine-cloud-20261003"
COOKIE = "machine_session"
FIELDS = {"seedCottonPrice": 6, "lintPrice": 0, "lintPercentage": 4, "lossPercentage": 4,
          "cottonseedPrice": 6, "processingFee": 2, "laborFee": 2, "warehouseFee": 2,
          "financeFee": 2, "subsidy": 2}
DEFAULT_MACHINE = dict(seedCottonPrice="7.3", lintPrice="", lintPercentage="38", lossPercentage="13",
                       cottonseedPrice="2.5", processingFee="1000", laborFee="0", warehouseFee="0",
                       financeFee="0", subsidy="0", basis="seed")
DYNAMIC = ["date", "lintPrice", "seedCottonPrice", "basis", "lintPercentage", "lossPercentage",
           "cottonseedPrice", "processingFee", "laborFee", "warehouseFee", "financeFee", "subsidy"]


def default_template():
    blocks = [dict(id="title", type="static", text="【籽棉单价测算】", visible=True)]
    blocks += [dict(id=key, type="dynamic", key=key, visible=True) for key in DYNAMIC[:3]]
    blocks += [dict(id="divider", type="divider", visible=True),
               dict(id="disclaimer", type="static", text="(数据仅供参考,以实际成交为准)", visible=True),
               dict(id="company", type="static", text="---公司名（可改）---", visible=True)]
    blocks += [dict(id=key, type="dynamic", key=key, visible=False) for key in DYNAMIC[3:]]
    return dict(schemaVersion=1, blocks=blocks)


def credential(password: str):
    salt = secrets.token_bytes(16)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 600_000, 32)
    return dict(algorithm="PBKDF2-HMAC-SHA256", credentialVersion=1, iterations=600_000,
                keyBits=256, saltBase64=base64.b64encode(salt).decode(),
                verifierBase64=base64.b64encode(derived).decode())


def validate_credential(value):
    expected = {"algorithm", "credentialVersion", "iterations", "keyBits", "saltBase64", "verifierBase64"}
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("Invalid bootstrap credential")
    if any(type(value[key]) is not int for key in ("credentialVersion", "iterations", "keyBits")):
        raise ValueError("Invalid bootstrap parameter types")
    if (value["algorithm"], value["credentialVersion"], value["iterations"], value["keyBits"]) != (
            "PBKDF2-HMAC-SHA256", 1, 600_000, 256):
        raise ValueError("Invalid bootstrap parameters")
    salt = base64.b64decode(value["saltBase64"], validate=True)
    verifier = base64.b64decode(value["verifierBase64"], validate=True)
    if len(salt) != 16 or len(verifier) != 32:
        raise ValueError("Invalid bootstrap bytes")
    return value


def verify(password, stored):
    value = json.loads(stored) if isinstance(stored, str) else stored
    salt = base64.b64decode(value["saltBase64"], validate=True)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, value["iterations"], 32)
    return hmac.compare_digest(derived, base64.b64decode(value["verifierBase64"], validate=True))


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


@dataclass
class Settings:
    database: Path
    bootstrap: Path | None
    origin: str
    secure_cookie: bool = True
    request_limit: int = 120
    auth_limit: int = 30
    clock: Callable[[], float] = time.time

    def __post_init__(self):
        parts = urlsplit(self.origin)
        if parts.path or parts.query or parts.fragment or parts.username or parts.scheme not in {"http", "https"}:
            raise ValueError("Origin must be a scheme and authority")
        if parts.scheme != "https" or not self.secure_cookie:
            if parts.hostname not in {"localhost", "127.0.0.1", "::1"} or self.secure_cookie:
                raise ValueError("Only explicit loopback development may use insecure cookies")

    @classmethod
    def from_env(cls):
        return cls(Path(os.environ["MACHINE_DATABASE"]), None,
                   os.environ["MACHINE_ORIGIN"], os.getenv("MACHINE_DEV_INSECURE") != "1")


class Body(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True, strict=True)


class Password(Body):
    password: str = Field(min_length=1, max_length=128)


class DoorLogin(Password):
    userId: str = Field(min_length=1, max_length=100)


class NewPassword(Body):
    newPassword: str = Field(min_length=8, max_length=128)
    confirmation: str = Field(min_length=8, max_length=128)


class ChangePassword(NewPassword):
    currentPassword: str = Field(min_length=1, max_length=128)


class CreateUser(Body):
    name: str = Field(min_length=1, max_length=40)
    doorPassword: str = Field(min_length=8, max_length=128)
    doorConfirmation: str = Field(min_length=8, max_length=128)
    settingsPassword: str = Field(min_length=8, max_length=128)
    settingsConfirmation: str = Field(min_length=8, max_length=128)


class UpdateUser(Body):
    name: str | None = Field(default=None, min_length=1, max_length=40)
    enabled: bool | None = None


class Configuration(Body):
    version: int = Field(ge=1)
    machine: dict
    template: dict


def validate_configuration(body):
    machine, template = body.machine, body.template
    if set(machine) != set(DEFAULT_MACHINE) or not isinstance(machine["basis"], str) or machine["basis"] not in {"seed", "lint"}:
        raise HTTPException(422, "计算参数格式不正确")
    for key, scale in FIELDS.items():
        value = machine[key]
        pattern = r"\d*" if not scale else rf"\d*(?:\.\d{{0,{scale}}})?"
        if not isinstance(value, str) or len(value) > 24 or not re.fullmatch(pattern, value):
            raise HTTPException(422, "计算参数格式不正确")
    try:
        values = {key: Decimal(machine[key] or "0") for key in FIELDS}
        inactive = "lintPrice" if machine["basis"] == "seed" else "seedCottonPrice"
        if any(not machine[key] or machine[key] == "." for key in FIELDS if key != inactive):
            raise InvalidOperation
        lint, loss = values["lintPercentage"], values["lossPercentage"]
        if not 0 < lint <= 100 or not 0 <= loss <= 100 or lint + loss > 100:
            raise InvalidOperation
        deduction = (100 - lint - loss) / 100 * values["cottonseedPrice"]
        fees = sum(values[key] for key in ("processingFee", "laborFee", "warehouseFee", "financeFee")) - values["subsidy"]
        result = ((values["seedCottonPrice"] - deduction) / (lint / 100) * 1000 + fees
                  if machine["basis"] == "seed" else (values["lintPrice"] - fees) / 1000 * (lint / 100) + deduction)
        if result < 0:
            raise InvalidOperation
    except InvalidOperation:
        raise HTTPException(422, "计算参数范围或计算结果不正确") from None
    if set(template) != {"schemaVersion", "blocks"} or type(template["schemaVersion"]) is not int or template["schemaVersion"] != 1:
        raise HTTPException(422, "模板格式不正确")
    blocks = template["blocks"]
    if not isinstance(blocks, list) or len(blocks) > 100:
        raise HTTPException(422, "模板格式不正确")
    ids, dynamic = set(), set()
    for block in blocks:
        if not isinstance(block, dict) or not isinstance(block.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", block["id"]):
            raise HTTPException(422, "模板格式不正确")
        if block["id"] in ids or type(block.get("visible")) is not bool:
            raise HTTPException(422, "模板格式不正确")
        ids.add(block["id"])
        kind = block.get("type")
        expected = {"id", "type", "visible"}
        if kind == "dynamic":
            expected.add("key")
            if block.get("key") not in DYNAMIC or block["key"] in dynamic:
                raise HTTPException(422, "动态字段不可替换或重复")
            dynamic.add(block["key"])
        elif kind == "static":
            expected.add("text")
            if not isinstance(block.get("text"), str) or len(block["text"]) > 200:
                raise HTTPException(422, "静态文字过长")
        elif kind != "divider":
            raise HTTPException(422, "模板格式不正确")
        if set(block) != expected:
            raise HTTPException(422, "模板格式不正确")
    if dynamic != set(DYNAMIC):
        raise HTTPException(422, "动态字段不可删除")


SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL,
 enabled INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, epoch INTEGER NOT NULL DEFAULT 1,
 door TEXT NOT NULL, settings TEXT NOT NULL);
CREATE UNIQUE INDEX unique_active_name ON users(name_key) WHERE deleted=0;
CREATE TABLE configs (user_id TEXT PRIMARY KEY REFERENCES users(id),
 version INTEGER NOT NULL, machine TEXT NOT NULL, template TEXT NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL,
 user_id TEXT REFERENCES users(id), epoch INTEGER, expires REAL NOT NULL);
CREATE TABLE elevations (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 role TEXT NOT NULL, user_id TEXT, epoch INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE attempts (scope TEXT PRIMARY KEY, failures INTEGER NOT NULL, until REAL NOT NULL);
CREATE TABLE limits (scope TEXT PRIMARY KEY, count INTEGER NOT NULL, until REAL NOT NULL);
"""


def initialize_database(database: Path, bootstrap_path: Path, before_commit=lambda: None):
    """Explicit one-shot command only. Atomic publish refuses any existing database."""
    if database.exists():
        raise ValueError("Database already exists; initialization refused")
    bootstrap = json.loads(bootstrap_path.read_text(encoding="utf-8"))
    if (not isinstance(bootstrap, dict)
            or set(bootstrap) != {"schemaVersion", "migrationGeneration", "defaultUser", "adminCredential"}
            or bootstrap["schemaVersion"] != 1 or bootstrap["migrationGeneration"] != GENERATION):
        raise ValueError("Invalid bootstrap contract")
    user = bootstrap["defaultUser"]
    if not isinstance(user, dict) or set(user) != {"name", "doorCredential", "settingsCredential"} or user["name"] != "默认用户":
        raise ValueError("Invalid default user")
    door, level1, admin = [validate_credential(item) for item in
                          (user["doorCredential"], user["settingsCredential"], bootstrap["adminCredential"])]
    database.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="machine-init-", dir=database.parent) as temporary:
        candidate = Path(temporary) / "machine.sqlite3"
        with closing(sqlite3.connect(candidate)) as con, con:
            con.executescript("BEGIN IMMEDIATE;" + SCHEMA)
            uid = str(uuid.uuid4())
            con.execute("INSERT INTO users(id,name,name_key,enabled,door,settings) VALUES (?,?,?,?,?,?)",
                        (uid, user["name"], user["name"].casefold(), 1, json.dumps(door), json.dumps(level1)))
            con.execute("INSERT INTO configs VALUES (?,?,?,?)", (uid, 1, json.dumps(DEFAULT_MACHINE), json.dumps(default_template())))
            con.executemany("INSERT INTO meta VALUES (?,?)", [("generation", GENERATION), ("admin", json.dumps(admin)), ("admin_epoch", "1")])
            before_commit()
        # A hard link is an atomic, no-overwrite publish on the same filesystem.
        os.link(candidate, database)


def ready_database(database):
    try:
        with closing(sqlite3.connect(database.resolve().as_uri() + "?mode=ro", uri=True, timeout=3)) as con:
            tables = {row[0] for row in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables != {"meta", "users", "configs", "sessions", "elevations", "attempts", "limits"}:
                return False
            columns = {
                "meta": ["key", "value"],
                "users": ["id", "name", "name_key", "enabled", "deleted", "epoch", "door", "settings"],
                "configs": ["user_id", "version", "machine", "template"],
                "sessions": ["id", "csrf", "user_id", "epoch", "expires"],
                "elevations": ["id", "session_id", "role", "user_id", "epoch", "expires"],
                "attempts": ["scope", "failures", "until"], "limits": ["scope", "count", "until"],
            }
            if any([row[1] for row in con.execute(f"PRAGMA table_info({name})")] != expected
                   for name, expected in columns.items()):
                return False
            index = con.execute("SELECT sql FROM sqlite_master WHERE name='unique_active_name' AND type='index'").fetchone()
            if not index or "WHERE deleted=0" not in index[0]:
                return False
            generation = con.execute("SELECT value FROM meta WHERE key='generation'").fetchone()
            admin = con.execute("SELECT value FROM meta WHERE key='admin'").fetchone()
            epoch = con.execute("SELECT value FROM meta WHERE key='admin_epoch'").fetchone()
            if not generation or generation[0] != GENERATION or not admin or not epoch or int(epoch[0]) < 1:
                return False
            validate_credential(json.loads(admin[0]))
            return True
    except (sqlite3.Error, OSError, ValueError, TypeError, KeyError):
        return False


def create_app(settings: Settings):

    @contextmanager
    def db():
        if not ready_database(settings.database):
            raise HTTPException(503, "服务尚未就绪，请联系管理员")
        con = sqlite3.connect(settings.database, timeout=15)
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA journal_mode=WAL")
        con.execute("BEGIN IMMEDIATE")
        try:
            yield con
        except HTTPException:
            con.commit()  # Authentication counters must survive a rejected request.
            raise
        except BaseException:
            con.rollback()
            raise
        else:
            con.commit()
        finally:
            con.close()

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    def rate(con, scope, limit):
        now = settings.clock()
        row = con.execute("SELECT * FROM limits WHERE scope=?", (scope,)).fetchone()
        if row and row["until"] > now:
            if row["count"] >= limit:
                raise HTTPException(429, "请求过于频繁，请稍后再试", headers={"Retry-After": str(max(1, int(row["until"] - now)))})
            con.execute("UPDATE limits SET count=count+1 WHERE scope=?", (scope,))
        else:
            con.execute("INSERT OR REPLACE INTO limits VALUES (?,?,?)", (scope, 1, now + 60))
            con.execute("DELETE FROM limits WHERE until<?", (now - 60,))

    def current_session(con, request):
        token = request.cookies.get(COOKIE, "")
        if len(token) > 200:
            return None
        row = con.execute("SELECT * FROM sessions WHERE id=? AND expires>?", (digest(token), settings.clock())).fetchone()
        if row and row["user_id"]:
            user = con.execute("SELECT * FROM users WHERE id=? AND enabled=1 AND deleted=0", (row["user_id"],)).fetchone()
            if not user or user["epoch"] != row["epoch"]:
                return None
        return row

    def authorize(con, request, role):
        session = current_session(con, request)
        if not session:
            raise HTTPException(401, "会话已失效，请重新登录")
        if role == "door":
            if not session["user_id"]:
                raise HTTPException(403, "请先选择用户并登录")
            return session
        token = request.headers.get("X-Machine-Elevation", "")
        elevation = con.execute("SELECT * FROM elevations WHERE id=? AND session_id=? AND role=? AND expires>?",
                                (digest(token), session["id"], role, settings.clock())).fetchone()
        if not elevation:
            raise HTTPException(403, "请通过十击入口解锁对应权限")
        if role == "settings":
            if not session["user_id"] or elevation["user_id"] != session["user_id"] or elevation["epoch"] != session["epoch"]:
                raise HTTPException(403, "授权已失效")
        else:
            epoch = int(con.execute("SELECT value FROM meta WHERE key='admin_epoch'").fetchone()[0])
            if elevation["epoch"] != epoch:
                raise HTTPException(403, "授权已失效")
        return session

    def prepare_password_check(con, request, scope):
        rate(con, "auth:" + (request.client.host if request.client else "unknown"), settings.auth_limit)
        row = con.execute("SELECT * FROM attempts WHERE scope=?", (scope,)).fetchone()
        now = settings.clock()
        if row and row["until"] > now:
            raise HTTPException(429, "连续验证失败，请等待三十秒", headers={"Retry-After": str(max(1, int(row["until"] - now)))})
        return row, now

    def check_password(con, request, scope, password, stored, prepared=None):
        row, now = prepared if prepared is not None else prepare_password_check(con, request, scope)
        if stored and verify(password, stored):
            con.execute("DELETE FROM attempts WHERE scope=?", (scope,))
            return
        failures = (row["failures"] if row and row["until"] == 0 else 0) + 1
        con.execute("INSERT OR REPLACE INTO attempts VALUES (?,?,?)", (scope, 0 if failures >= 5 else failures, now + 30 if failures >= 5 else 0))
        if failures >= 5:
            raise HTTPException(429, "连续验证失败，请等待三十秒", headers={"Retry-After": "30"})
        raise HTTPException(401, "密码不正确")

    def issue_session(con, response, user=None):
        token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
        con.execute("DELETE FROM sessions WHERE expires<?", (settings.clock(),))
        con.execute("INSERT INTO sessions VALUES (?,?,?,?,?)", (digest(token), csrf, user["id"] if user else None,
                                                              user["epoch"] if user else None, settings.clock() + 28800))
        response.set_cookie(COOKIE, token, max_age=28800, path="/v2", httponly=True,
                            secure=settings.secure_cookie, samesite="strict")
        return csrf

    def user_view(user):
        return {"id": user["id"], "name": user["name"], "enabled": bool(user["enabled"])}

    def revoke(con, uid):
        con.execute("UPDATE users SET epoch=epoch+1 WHERE id=?", (uid,))
        con.execute("DELETE FROM sessions WHERE user_id=?", (uid,))

    def confirm(body):
        if body.newPassword != body.confirmation:
            raise HTTPException(422, "两次输入的新密码不一致")

    def reject_cross_level(con, password, for_admin=False):
        # Called only after authorization/required old-password checks, inside db's
        # BEGIN IMMEDIATE transaction. Never store a comparable password fingerprint.
        if for_admin:
            collision = any(verify(password, row[kind])
                            for row in con.execute("SELECT door,settings FROM users WHERE deleted=0")
                            for kind in ("door", "settings"))
        else:
            collision = verify(password, con.execute("SELECT value FROM meta WHERE key='admin'").fetchone()[0])
        if collision:
            raise HTTPException(422, "新密码与其他权限层级冲突，请使用不同密码")

    @app.exception_handler(RequestValidationError)
    async def invalid_body(request, exc):
        return JSONResponse({"detail": "请求字段或长度不正确"}, status_code=422)

    @app.middleware("http")
    async def guards(request, call_next):
        if not request.url.path.startswith(PREFIX + "/"):
            return await call_next(request)
        try:
            if request.url.path in {PREFIX + "/healthz", PREFIX + "/readyz"}:
                response = await call_next(request)
                response.headers["Cache-Control"] = "no-store, max-age=0"
                return response
            if request.headers.get("host") != urlsplit(settings.origin).netloc:
                raise HTTPException(400, "请求来源不正确")
            with db() as con:
                rate(con, "ip:" + (request.client.host if request.client else "unknown"), settings.request_limit)
                if request.method not in {"GET", "HEAD", "OPTIONS"}:
                    if request.headers.get("origin") != settings.origin:
                        raise HTTPException(403, "请求来源不正确")
                    if request.headers.get("content-type", "").split(";")[0] != "application/json":
                        raise HTTPException(415, "需要 JSON 请求")
                    session = current_session(con, request)
                    if not session or not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), session["csrf"]):
                        raise HTTPException(403, "会话校验失败，请重新载入")
            response = await call_next(request)
        except HTTPException as exc:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Vary"] = "Cookie"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get(PREFIX + "/healthz")
    def health():
        return {"status": "alive"}

    @app.get(PREFIX + "/readyz")
    def ready():
        if not ready_database(settings.database):
            raise HTTPException(503, "服务尚未就绪")
        return {"status": "ready"}

    @app.get(PREFIX + "/users")
    def public_users():
        with db() as con:
            return [{"id": row["id"], "name": row["name"]} for row in con.execute("SELECT id,name FROM users WHERE enabled=1 AND deleted=0 ORDER BY name")]

    @app.get(PREFIX + "/session")
    def get_session(request: Request, response: Response):
        with db() as con:
            session = current_session(con, request)
            if not session:
                return {"csrf": issue_session(con, response), "user": None}
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone() if session["user_id"] else None
            return {"csrf": session["csrf"], "user": user_view(user) if user else None}

    @app.post(PREFIX + "/login")
    def login(body: DoorLogin, request: Request, response: Response):
        with db() as con:
            user = con.execute("SELECT * FROM users WHERE id=? AND enabled=1 AND deleted=0", (body.userId,)).fetchone()
            check_password(con, request, "door:" + body.userId, body.password, user["door"] if user else None)
            old = current_session(con, request)
            if old:
                con.execute("DELETE FROM sessions WHERE id=?", (old["id"],))
            return {"csrf": issue_session(con, response, user), "user": user_view(user)}

    @app.post(PREFIX + "/unlock")
    def unlock(body: Password, request: Request):
        with db() as con:
            session = current_session(con, request)
            if not session:
                raise HTTPException(401, "会话已失效")
            scope = "unlock:" + (session["user_id"] or "anonymous")
            prepared = prepare_password_check(con, request, scope)
            admin = con.execute("SELECT value FROM meta WHERE key='admin'").fetchone()[0]
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone() if session["user_id"] else None
            # The role is derived here, never accepted from the client.
            if verify(body.password, admin):
                role, epoch, uid = "admin", int(con.execute("SELECT value FROM meta WHERE key='admin_epoch'").fetchone()[0]), None
                check_password(con, request, scope, body.password, admin, prepared)
            else:
                role, epoch, uid = "settings", user["epoch"] if user else 0, session["user_id"]
                check_password(con, request, scope, body.password, user["settings"] if user else None, prepared)
            con.execute("DELETE FROM elevations WHERE session_id=?", (session["id"],))
            token = secrets.token_urlsafe(32)
            con.execute("INSERT INTO elevations VALUES (?,?,?,?,?,?)", (digest(token), session["id"], role, uid, epoch, settings.clock() + 900))
            return {"role": role, "elevation": token}

    @app.post(PREFIX + "/logout")
    def logout(request: Request, response: Response):
        with db() as con:
            session = current_session(con, request)
            if session:
                con.execute("DELETE FROM sessions WHERE id=?", (session["id"],))
        response.delete_cookie(COOKIE, path="/v2", secure=settings.secure_cookie, httponly=True, samesite="strict")
        return {"ok": True}

    @app.get(PREFIX + "/me/config")
    def read_config(request: Request):
        with db() as con:
            session = authorize(con, request, "door")
            row = con.execute("SELECT * FROM configs WHERE user_id=?", (session["user_id"],)).fetchone()
            return {"version": row["version"], "machine": json.loads(row["machine"]), "template": json.loads(row["template"])}

    @app.put(PREFIX + "/me/config")
    def write_config(body: Configuration, request: Request):
        with db() as con:
            session = authorize(con, request, "settings")
            validate_configuration(body)
            changed = con.execute("UPDATE configs SET machine=?,template=?,version=version+1 WHERE user_id=? AND version=?",
                                  (json.dumps(body.machine), json.dumps(body.template), session["user_id"], body.version)).rowcount
            if not changed:
                raise HTTPException(409, "配置已在其他会话修改，请重新读取后再编辑")
            return {"version": body.version + 1}

    @app.post(PREFIX + "/me/password/{kind}")
    def own_password(kind: Literal["door", "settings"], body: ChangePassword, request: Request):
        with db() as con:
            session = authorize(con, request, "settings")
            confirm(body)
            user = con.execute("SELECT * FROM users WHERE id=?", (session["user_id"],)).fetchone()
            check_password(con, request, "change:" + kind + ":" + user["id"], body.currentPassword, user[kind])
            reject_cross_level(con, body.newPassword)
            con.execute(f"UPDATE users SET {kind}=? WHERE id=?", (json.dumps(credential(body.newPassword)), user["id"]))
            revoke(con, user["id"])
            return {"ok": True, "relogin": True}

    @app.get(PREFIX + "/admin/users")
    def list_users(request: Request):
        with db() as con:
            authorize(con, request, "admin")
            return [user_view(row) for row in con.execute("SELECT * FROM users WHERE deleted=0 ORDER BY name")]

    @app.post(PREFIX + "/admin/users", status_code=201)
    def add_user(body: CreateUser, request: Request):
        with db() as con:
            authorize(con, request, "admin")
            name = body.name.strip()
            if not name or body.doorPassword != body.doorConfirmation or body.settingsPassword != body.settingsConfirmation:
                raise HTTPException(422, "名称不能为空且新密码需确认一致")
            if con.execute("SELECT 1 FROM users WHERE name_key=? AND deleted=0", (name.casefold(),)).fetchone():
                raise HTTPException(409, "用户名已存在")
            reject_cross_level(con, body.doorPassword)
            reject_cross_level(con, body.settingsPassword)
            uid = str(uuid.uuid4())
            con.execute("INSERT INTO users(id,name,name_key,enabled,door,settings) VALUES (?,?,?,?,?,?)",
                        (uid, name, name.casefold(), 1, json.dumps(credential(body.doorPassword)), json.dumps(credential(body.settingsPassword))))
            con.execute("INSERT INTO configs VALUES (?,?,?,?)", (uid, 1, json.dumps(DEFAULT_MACHINE), json.dumps(default_template())))
            return {"id": uid, "name": name, "enabled": True}

    def target_user(con, uid):
        user = con.execute("SELECT * FROM users WHERE id=? AND deleted=0", (uid,)).fetchone()
        if not user:
            raise HTTPException(404, "用户不存在")
        return user

    @app.patch(PREFIX + "/admin/users/{uid}")
    def edit_user(uid: str, body: UpdateUser, request: Request):
        with db() as con:
            authorize(con, request, "admin")
            user = target_user(con, uid)
            name = body.name.strip() if body.name is not None else user["name"]
            if not name:
                raise HTTPException(422, "名称不能为空")
            if con.execute("SELECT 1 FROM users WHERE name_key=? AND deleted=0 AND id!=?", (name.casefold(), uid)).fetchone():
                raise HTTPException(409, "用户名已存在")
            enabled = body.enabled if body.enabled is not None else bool(user["enabled"])
            con.execute("UPDATE users SET name=?,name_key=?,enabled=? WHERE id=?", (name, name.casefold(), int(enabled), uid))
            if body.enabled is not None:
                revoke(con, uid)
            return {"id": uid, "name": name, "enabled": enabled}

    @app.delete(PREFIX + "/admin/users/{uid}")
    def delete_user(uid: str, request: Request):
        with db() as con:
            authorize(con, request, "admin")
            target_user(con, uid)
            con.execute("UPDATE users SET deleted=1,enabled=0 WHERE id=?", (uid,))
            revoke(con, uid)
            return {"ok": True}

    @app.post(PREFIX + "/admin/users/{uid}/password/{kind}")
    def reset_password(uid: str, kind: Literal["door", "settings"], body: NewPassword, request: Request):
        with db() as con:
            authorize(con, request, "admin")
            target_user(con, uid)
            confirm(body)
            reject_cross_level(con, body.newPassword)
            con.execute(f"UPDATE users SET {kind}=? WHERE id=?", (json.dumps(credential(body.newPassword)), uid))
            revoke(con, uid)
            return {"ok": True}

    @app.post(PREFIX + "/admin/password")
    def admin_password(body: ChangePassword, request: Request):
        with db() as con:
            authorize(con, request, "admin")
            confirm(body)
            stored = con.execute("SELECT value FROM meta WHERE key='admin'").fetchone()[0]
            check_password(con, request, "change:admin", body.currentPassword, stored)
            reject_cross_level(con, body.newPassword, for_admin=True)
            con.execute("UPDATE meta SET value=? WHERE key='admin'", (json.dumps(credential(body.newPassword)),))
            con.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='admin_epoch'")
            con.execute("DELETE FROM elevations WHERE role='admin'")
            return {"ok": True, "relogin": True}

    return app


def production_app():
    return create_app(Settings.from_env())
