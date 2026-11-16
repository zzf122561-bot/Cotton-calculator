import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { LatestIntent } from "../factory/shared.js";
import { ManagementSession } from "../factory/management-session.js";

const source = (await readFile(new URL("../factory/manage.js", import.meta.url), "utf8")).replace(/^import .*;\r?\n/gm, "");
const html = await readFile(new URL("../factory/manage.html", import.meta.url), "utf8");
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function harness({ role = "platform", autoLogin = true, offline = false } = {}) {
  const nodes = new Map(), calls = [], confirmations = [], answers = [], listeners = {}, timers = new Map(), downloads = [];
  let timerId = 0;
  class Node {
    constructor(tag = "div") {
      this.tagName = tag; this.children = []; this.value = ""; this.disabled = false; this.checked = false;
      this.hidden = false; this._text = ""; this.classList = { toggle() {} };
    }
    set textContent(value) { this._text = value ?? ""; this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(""); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this._text = ""; this.children = children; }
    setAttribute(key, value) { this[key] = value; }
    addEventListener(type, action) { this["on" + type] = action; }
    reset() { for (const node of this.querySelectorAll()) { node.value = ""; node.checked = false; } }
    querySelectorAll(selector = "") {
      const descendants = this.children.flatMap(node => [node, ...node.querySelectorAll()]);
      return selector === "input:checked" ? descendants.filter(node => node.tagName === "input" && node.checked) : descendants;
    }
    click() { downloads.push(this.download); }
    remove() {}
  }
  for (const [, tag, id] of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) nodes.set(id, new Node(tag));
  const element = (tag, text, className) => { const node = new Node(tag); node.textContent = text; node.className = className; return node; };
  const button = (text, action) => { const node = element("button", text); node.onclick = action; return node; };
  const config = { version: 1, parameters: { processingFee: "1000" }, template: [{ id: "text-1", type: "text", text: "original", visible: true }] };
  const factories = ["a", "b"].map(id => ({ id, name: id, code: id, version: 1, username: id, enabled: true, shareEditable: true, editable: ["processingFee"] }));
  const state = { now: 0, role, offline, put: null, failRead: false, resetGate: null, deliveryGates: new Map(), revoked: false,
    cookieIdentity: { role, username: "previous-manager" }, objectUrls: [] };
  const response = (body, status = 200) => ({ ok: status === 200, status, json: async () => body, blob: async () => new Blob(["phone\n13900000000"]) });
  const fetcher = async (url, options) => {
    const path = url.replace("/v2/factory-api/manage", ""), method = options.method;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, body, headers: options.headers });
    if (state.offline) throw new Error("offline");
    if (path === "/session") {
      if (state.resetGate) await state.resetGate.promise;
      state.cookieIdentity = null;
      return response({ csrf: "anonymous-test", identity: null });
    }
    if (path === "/login") {
      state.cookieIdentity = { role: state.role, username: body.username };
      return response({ csrf: "page-test", identity: state.cookieIdentity, expiresIn: 3600 });
    }
    if (state.revoked) return response({ detail: "expired" }, 401);
    if (path === "/factories" && method === "GET") return response({ factories: structuredClone(factories) });
    if (path.endsWith("/contacts")) return response({ contacts: [{ phone: "13900000000", created: 100 }] });
    if (path.endsWith("/preview")) return response({ shareText: body.template[0].text });
    if (path.startsWith("/config/")) {
      if (method === "PUT") {
        if (state.put) await state.put;
        Object.assign(config, structuredClone(body), { version: config.version + 1 });
      } else if (state.failRead) throw new Error("read failed");
      return response(structuredClone(config));
    }
    return response({ id: "b" });
  };
  const schedule = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: state.now + delay }); return id; };
  class PageSession extends ManagementSession {
    constructor(options) { super({ ...options, fetcher, clock: () => state.now, monotonic: () => state.now, schedule, cancel: id => timers.delete(id) }); }
    async call(path, method = "GET", body) {
      const result = await super.call(path, method, body);
      // A yield after transport validation checks the UI guard independently.
      const gate = state.deliveryGates.get(method + ":" + path);
      if (gate) { state.deliveryGates.delete(method + ":" + path); await gate.promise; }
      return result;
    }
    async download(path) {
      const result = await super.download(path);
      const gate = state.deliveryGates.get("DOWNLOAD:" + path);
      if (gate) { state.deliveryGates.delete("DOWNLOAD:" + path); await gate.promise; }
      return result;
    }
  }
  const allNodes = () => [...new Set([...nodes.values()].flatMap(node => [node, ...node.querySelectorAll()]))];
  const document = { body: new Node("body"), visibilityState: "visible", createTextNode: text => element("text", text),
    querySelectorAll: selector => allNodes().filter(node => selector === "details" ? node.tagName === "details" : ["input", "textarea", "select"].includes(node.tagName)),
    addEventListener: (type, action) => { listeners[type] = action; } };
  const context = vm.createContext({ ManagementSession: PageSession, $: id => nodes.get(id), PARAMETERS: { processingFee: ["加工费", "元/吨"] }, LABELS: {},
    element, button, status: message => { nodes.get("status").textContent = message; }, readableTime: String, LatestIntent,
    document, window: { addEventListener: (type, action) => { listeners[type] = action; } },
    URL: { createObjectURL: () => { const url = "blob:test-" + state.objectUrls.length; state.objectUrls.push(url); return url; }, revokeObjectURL() {} },
    structuredClone, setTimeout: schedule, clearTimeout: id => timers.delete(id), crypto: { randomUUID: () => "test-text" },
    confirm: message => { confirmations.push(message); return answers.shift() ?? false; },
  });
  const value = code => vm.runInContext(code, context);
  const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
  const login = async () => {
    nodes.get("username").value = "test"; nodes.get("password").value = "synthetic-test";
    nodes.get("login-form").onsubmit({ preventDefault() {} }); await flush();
  };
  vm.runInContext(source, context); await flush();
  assert.equal(nodes.get("management").hidden, true, nodes.get("status").textContent);
  if (autoLogin) { await login(); await value('run(() => selectFactory("a"))'); }
  calls.length = 0;
  const edit = async () => {
    value('controls.processingFee.value = "1250"; controls.processingFee.oninput(); template[0].text = "draft";');
    await value("preview()"); calls.length = 0;
  };
  const hold = key => { const gate = deferred(); state.deliveryGates.set(key, gate); return gate; };
  const advance = async (milliseconds, fire = true) => {
    state.now += milliseconds;
    if (fire) for (const [id, timer] of [...timers]) if (timer.at <= state.now) { timers.delete(id); timer.fn(); }
    await flush();
  };
  return { nodes, calls, confirmations, answers, state, edit, flush, value, listeners, login, hold, advance, document, downloads };
}
function assertCleared(h) {
  assert.equal(h.value("identity"), undefined); assert.equal(h.value("config"), undefined);
  for (const expression of ["factories.length", "template.length", "Object.keys(controls).length"]) assert.equal(h.value(expression), 0);
  assert.equal(h.value("selectedId"), ""); assert.equal(h.value("previewBody"), ""); assert.equal(h.value("dirty"), false);
  for (const id of ["parameter-fields", "template-editor", "permission-fields", "contacts", "factory-select"]) assert.equal(h.nodes.get(id).children.length, 0, id);
  for (const id of ["manager-name", "factory-info", "factory-code", "config-version", "config-preview", "contact-count"]) assert.equal(h.nodes.get(id).textContent, "", id);
  for (const node of h.document.querySelectorAll("input, textarea, select")) assert.equal(node.value, "");
  assert.equal(h.nodes.get("management").hidden, true); assert.equal(h.nodes.get("login-panel").hidden, false);
  assert.equal(h.nodes.get("logout").hidden, true);
}

test("management metadata and code rotation cancel before mutation and keep draft", async () => {
  const h = await harness(); await h.edit();
  h.nodes.get("permissions-form").onsubmit({ preventDefault() {} }); await h.flush();
  assert.equal(h.calls.length, 0); assert.equal(h.value("controls.processingFee.value"), "1250");
  h.answers.push(true, false); h.nodes.get("rotate-code").onclick(); await h.flush();
  assert.equal(h.calls.length, 0); assert.equal(h.value("template[0].text"), "draft"); assert.equal(h.value("dirty"), true);
});
test("management confirmed reload replaces draft only after successful read", async () => {
  const h = await harness(); await h.edit(); h.state.failRead = true; h.answers.push(true);
  h.nodes.get("reload-config").onclick(); await h.flush();
  assert.equal(h.value("dirty"), true); assert.equal(h.value("controls.processingFee.value"), "1250");
  h.state.failRead = false; h.answers.push(true); h.nodes.get("reload-config").onclick(); await h.flush();
  assert.equal(h.value("dirty"), false); assert.equal(h.value("controls.processingFee.value"), "1000");
});
test("management publishing locks editor and target through deferred response", async () => {
  const h = await harness(); await h.edit(); const gate = deferred(); h.state.put = gate.promise;
  const publishing = h.nodes.get("publish-config").onclick(); await h.flush();
  assert.equal(h.nodes.get("management-lock").disabled, true);
  h.nodes.get("factory-select").value = "b"; h.nodes.get("factory-select").onchange();
  assert.equal(h.nodes.get("factory-select").value, "a"); assert.equal(h.value("selectedId"), "a");
  assert.equal(h.calls.find(call => call.method === "PUT").path, "/config/a");
  gate.resolve(); await publishing;
  assert.equal(h.nodes.get("management-lock").disabled, false); assert.equal(h.value("dirty"), false);
  assert.equal(h.value("controls.processingFee.value"), "1250");
});
test("management failed publication unlocks without losing parameters or text", async () => {
  const h = await harness(); await h.edit(); const gate = deferred(); h.state.put = gate.promise;
  const publishing = h.nodes.get("publish-config").onclick(); gate.reject(new Error("network failed")); await publishing;
  assert.equal(h.nodes.get("management-lock").disabled, false); assert.equal(h.value("dirty"), true);
  assert.equal(h.value("controls.processingFee.value"), "1250"); assert.equal(h.value("template[0].text"), "draft");
});
test("management switch create and password change require draft discard; logout clears immediately", async () => {
  const h = await harness(); await h.edit();
  h.nodes.get("factory-select").value = "b"; h.nodes.get("factory-select").onchange();
  assert.equal(h.nodes.get("factory-select").value, "a");
  for (const id of ["create-form", "own-password-form"]) h.nodes.get(id).onsubmit({ preventDefault() {} });
  await h.flush(); assert.equal(h.calls.length, 0); assert.equal(h.confirmations.length, 3);
  const logout = h.nodes.get("logout").onclick(); assertCleared(h); await logout;
  assert.equal(h.confirmations.length, 3);
});
for (const role of ["platform", "factory"]) test(`${role} management never restores old cookie identity on opening`, async () => {
  const h = await harness({ role, autoLogin: false });
  assertCleared(h); assert.equal(h.nodes.get("login-button").disabled, false); assert.equal(h.state.cookieIdentity, null);
  assert.equal(h.calls.length, 0); await h.login();
  assert.equal(h.value("identity.role"), role); assert.equal(h.nodes.get("management").hidden, false);
});
for (const [name, path, action] of [
  ["contacts", "GET:/factories/a/contacts", '$("refresh-contacts").onclick()'],
  ["configuration", "GET:/config/a", "run(loadConfig)"],
  ["factory list", "GET:/factories", "run(loadFactories)"],
  ["preview", "POST:/config/a/preview", '$("preview-config").onclick()'],
  ["publish", "PUT:/config/a", '$("publish-config").onclick()'],
  ["download", "DOWNLOAD:/factories/a/contacts.csv", '$("export-contacts").onclick()'],
]) test(`late ${name} delivery cannot restore sensitive management after logout`, async () => {
  const h = await harness(); await h.edit(); const gate = h.hold(path);
  const pending = h.value(action); await h.flush();
  assert.equal(h.nodes.get("management-lock").disabled, true);
  await h.nodes.get("logout").onclick(); assertCleared(h);
  const statusBefore = h.nodes.get("status").textContent, callsAfterLogout = h.calls.length;
  gate.resolve(); await pending; await h.flush();
  assertCleared(h); assert.equal(h.calls.length, callsAfterLogout, "no follow-on requests after logout");
  assert.equal(h.nodes.get("status").textContent, statusBefore); assert.equal(h.downloads.length, 0);
});
test("old management finally cannot unlock a busy new login generation", async () => {
  const h = await harness(), oldGate = h.hold("GET:/factories/a/contacts");
  const old = h.nodes.get("refresh-contacts").onclick(); await h.flush();
  await h.nodes.get("logout").onclick();
  const newGate = h.hold("GET:/factories"); await h.login();
  assert.equal(h.nodes.get("management-lock").disabled, true);
  oldGate.resolve(); await old;
  assert.equal(h.nodes.get("management-lock").disabled, true); assert.equal(h.value("busy"), true);
  newGate.resolve(); await h.flush(); assert.equal(h.nodes.get("management-lock").disabled, false);
});
test("absolute management expiry clears drafts fields and contacts without waiting for network", async () => {
  const h = await harness(); await h.edit(); h.nodes.get("new-password").value = "unsaved-password";
  h.state.offline = true; await h.advance(3600000);
  assertCleared(h); assert.equal(h.nodes.get("login-button").disabled, true);
  const before = h.calls.length; h.nodes.get("publish-config").onclick(); await h.flush(); assert.equal(h.calls.length, before);
});
test("offline logout clears immediately and online reset enables a fresh login", async () => {
  const h = await harness(); await h.edit(); h.state.offline = true;
  const logout = h.nodes.get("logout").onclick(); assertCleared(h); await logout;
  assert.equal(h.nodes.get("login-button").disabled, true);
  h.state.offline = false; const gate = deferred(); h.state.resetGate = gate;
  h.listeners.online(); await h.flush(); assert.equal(h.nodes.get("login-button").disabled, true);
  gate.resolve(); await h.flush(); assert.equal(h.nodes.get("login-button").disabled, false); assertCleared(h);
});
test("pagehide and persisted pageshow clear management and require authentication again", async () => {
  const h = await harness(); await h.edit(); const before = h.calls.length;
  h.listeners.pagehide(); assertCleared(h); assert.equal(h.calls.length, before);
  h.listeners.pageshow({ persisted: true }); await h.flush(); assertCleared(h);
  assert.equal(h.nodes.get("login-button").disabled, false);
  assert.deepEqual(h.calls.slice(before).map(call => call.path), ["/session"]);
});
for (const event of ["focus", "visibilitychange", "online"]) test(`${event} checks expired management before any protected operation`, async () => {
  const h = await harness(); await h.edit(); await h.advance(3600001, false); const before = h.calls.length;
  h.listeners[event](); await h.flush(); assertCleared(h);
  assert.deepEqual(h.calls.slice(before).map(call => call.path), ["/session"]);
});
test("foreground server revocation clears sensitive management even on defaults", async () => {
  const h = await harness(); await h.value('run(() => selectFactory("defaults"))'); h.state.revoked = true;
  h.listeners.focus(); await h.flush(); assertCleared(h);
});
test("management logout stays outside disabled fieldset and contact controls remain after copy removal", () => {
  assert.ok(html.indexOf('id="logout"') < html.indexOf('id="management-lock"'));
  assert.ok(html.includes('id="export-contacts"')); assert.ok(html.includes('id="refresh-contacts"'));
  assert.equal(html.includes("手机号由使用者进入本厂时填写"), false);
});
