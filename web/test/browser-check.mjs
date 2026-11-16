import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultState } from "../js/calculator.js";
import { createRecordSnapshot, serializeRecords, serializeComparison } from "../js/records.js";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const edgePath = process.env.EDGE_PATH;
if (!edgePath && process.env.NODE_TEST_CONTEXT) {
  const { test } = await import("node:test");
  test("桌面浏览器检查需要显式 EDGE_PATH", { skip: true }, () => {});
} else {
  if (!edgePath || !process.env.API_PYTHON) throw new Error("EDGE_PATH and scoped API_PYTHON required");
  const port = Number(process.env.BROWSER_CHECK_PORT ?? 4187), debugPort = Number(process.env.EDGE_DEBUG_PORT ?? 9235);
  const base = "http://127.0.0.1:" + port + "/v2/", build = resolve(root, "build");
  const profile = resolve(build, "cloud-browser-" + process.pid), childPath = relative(build, profile);
  assert.ok(childPath && !childPath.startsWith("..") && !isAbsolute(childPath));
  await mkdir(profile, { recursive: true });
  const server = spawn(process.env.API_PYTHON, ["test_server.py"], { cwd: resolve(root, "api"),
    env: { ...process.env, BROWSER_CHECK_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const edge = spawn(edgePath, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=" + debugPort, "--remote-debugging-address=127.0.0.1", "--user-data-dir=" + profile, "about:blank"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let diagnostics = "", socket, nextId = 1;
  const pending = new Map(), exceptions = [];
  for (const child of [server, edge]) for (const stream of [child.stdout, child.stderr])
    stream.on("data", chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-2000); });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  async function poll(url) {
    for (let i = 0; i < 150; i++) {
      try { const response = await fetch(url); if (response.ok) return response; } catch { /* starting */ }
      if (edge.exitCode !== null || server.exitCode !== null) break;
      await wait(100);
    }
    throw new Error("Local process not ready: " + diagnostics);
  }
  function send(method, params = {}, sessionId) {
    return new Promise((done, reject) => {
      const id = nextId++; pending.set(id, { done, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function terminate(child) {
    if (!child.pid || child.exitCode !== null) return;
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    await new Promise(done => { killer.once("exit", done); killer.once("error", done); });
  }
  try {
    await poll(base + "api/healthz");
    const version = await (await poll("http://127.0.0.1:" + debugPort + "/json/version")).json();
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((done, reject) => { socket.addEventListener("open", done, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
      if (!pending.has(message.id)) return;
      const callback = pending.get(message.id); pending.delete(message.id);
      if (message.error) callback.reject(new Error(JSON.stringify(message.error))); else callback.done(message.result);
    });
    async function page(seed = "") {
      const { browserContextId } = await send("Target.createBrowserContext", { disposeOnDetach: true });
      const { targetId } = await send("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      const command = (method, params) => send(method, params, sessionId);
      await command("Page.enable"); await command("Runtime.enable"); await command("Network.enable");
      await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      if (seed) await command("Page.addScriptToEvaluateOnNewDocument", { source: seed });
      const evaluate = async expression => {
        const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
        return result.result.value;
      };
      const until = async expression => {
        for (let i = 0; i < 250; i++) { if (await evaluate(expression)) return; await wait(50); }
        throw new Error("Browser condition timed out: " + expression);
      };
      const ready = () => until("document.readyState === 'complete' && document.getElementById('door-user')?.options.length > 0 && !document.getElementById('door-submit').disabled");
      const click = id => evaluate("document.getElementById(" + JSON.stringify(id) + ").click()");
      const fill = values => evaluate(Object.entries(values).map(([id, value]) =>
        "document.getElementById(" + JSON.stringify(id) + ").value=" + JSON.stringify(value)).join(";"));
      const submit = id => evaluate("document.getElementById(" + JSON.stringify(id) + ").requestSubmit()");
      const login = async userId => {
        await fill({ "door-user": userId, "door-password": "browser-door-fixture" }); await submit("door-form");
        await until("!document.getElementById('calculator-content').hidden");
      };
      const unlock = async (password, role = "settings") => {
        await evaluate("for(let i=0;i<10;i++) document.getElementById('settings-trigger').click()");
        await until("document.getElementById('unlock-dialog').open");
        await fill({ "unlock-password": password }); await submit("unlock-form");
        await until(role === "admin" ? "document.getElementById('admin-dialog').open" : "document.getElementById('parameter-card') !== null");
      };
      const edit = (id, value) => evaluate("{const input=document.getElementById(" + JSON.stringify(id) + ");input.value=" +
        JSON.stringify(value) + ";input.dispatchEvent(new Event('input',{bubbles:true}));}");
      await command("Page.navigate", { url: base + "?theme=light" }); await ready();
      return { command, evaluate, until, click, fill, submit, login, unlock, edit, ready };
    }
    const legacy = createRecordSnapshot(createDefaultState(), { note: "旧遗留合成快照" });
    const seeded = { "cottoncal.machine.history.v1": serializeRecords([legacy]), "cottoncal.machine.comparison.v1": serializeComparison([legacy.id]),
      "cottoncal.machine.theme.v1": JSON.stringify({ palette: "gold", customColor: "#595e63" }),
      "cottoncal.machine.users.v1": "obsolete", "cottoncal.machine.admin-credential.v1": "obsolete",
      "cottoncal.machine.v1": "obsolete", "cottoncal.machine.share-template.v1": "obsolete" };
    const seed = "if(location.pathname.startsWith('/v2/')&&!localStorage.getItem('fixture-seeded')){" +
      Object.entries(seeded).map(([key, value]) => "localStorage.setItem(" + JSON.stringify(key) + "," + JSON.stringify(value) + ");").join("") +
      "localStorage.setItem('fixture-seeded','1');}";
    const a = await page(seed), b = await page();
    if (process.env.COLLISION_ONLY === "1") {
      const uid = await a.evaluate("document.getElementById('door-user').value");
      await a.login(uid); await a.unlock("browser-level1-fixture"); await a.click("settings-tools");
      await b.unlock("browser-admin-fixture", "admin");
      for (const [kind, current] of [["door", "browser-door-fixture"], ["settings", "browser-level1-fixture"]]) {
        await a.evaluate("document.getElementById('own-password-status').textContent=''");
        await a.fill({ "own-password-kind": kind, "own-current-password": current,
          "own-new-password": "browser-admin-fixture", "own-confirm-password": "browser-admin-fixture" });
        await a.submit("own-password-form");
        await a.until("document.getElementById('own-password-status').textContent.includes('层级冲突') && document.getElementById('own-password-section').getAttribute('aria-busy') === 'false'");
        assert.equal(await a.evaluate("import('./js/app.js').then(m=>m.api.role)"), "settings");
        assert.equal(await a.evaluate("document.getElementById('settings-dialog').open"), true);
      }
      await b.fill({ "new-user-name": "不应部分创建", "new-user-door": "browser-admin-fixture", "new-user-door-confirm": "browser-admin-fixture",
        "new-user-password": "browser-level1-fixture", "new-user-confirm": "browser-level1-fixture" });
      await b.submit("new-user-form");
      await b.until("document.getElementById('user-admin-status').textContent.includes('层级冲突') && document.getElementById('user-admin-section').getAttribute('aria-busy') === 'false'");
      assert.equal(await b.evaluate("document.querySelectorAll('#admin-user-list .admin-user-row').length"), 1);
      for (const kind of ["door", "settings"]) {
        await b.evaluate("document.getElementById('user-admin-status').textContent=''; {const row=document.querySelector('#admin-user-list .admin-user-row'); row.querySelector('[data-user-kind]').value=" +
          JSON.stringify(kind) + ";row.querySelector('[data-user-password]').value='browser-admin-fixture';row.querySelector('[data-user-confirm]').value='browser-admin-fixture';row.querySelector('[data-action=\"reset-user\"]').click();}");
        await b.until("document.getElementById('user-admin-status').textContent.includes('层级冲突') && document.getElementById('user-admin-section').getAttribute('aria-busy') === 'false'");
      }
      await b.fill({ "admin-current-password": "browser-admin-fixture", "admin-new-password": "browser-door-fixture",
        "admin-confirm-password": "browser-door-fixture" });
      await b.submit("admin-credential-form");
      await b.until("document.getElementById('admin-credential-status').textContent.includes('层级冲突') && document.getElementById('admin-credential-section').getAttribute('aria-busy') === 'false'");
      assert.equal(await b.evaluate("import('./js/app.js').then(m=>m.api.role)"), "admin");
      assert.equal(await a.evaluate("import('./js/app.js').then(m=>m.api.request('/me/config')).then(x=>x.version)"), 1);
      assert.equal(await b.evaluate("import('./js/app.js').then(m=>m.api.request('/admin/users')).then(x=>x.length)"), 1);
      assert.deepEqual(exceptions, []);
      console.log("BROWSER_COLLISION_OK Edge1280x900 real-local-API own-door own-settings creation admin-reset-door admin-reset-settings admin-change generic-conflict preserved-role preserved-credentials no-partial-write");
    } else {
    assert.equal(await a.evaluate("document.getElementById('calculator-content').hidden"), true);
    assert.equal(await a.evaluate("localStorage.getItem('cottoncal.machine.users.v1')"), null);
    assert.equal(await a.evaluate("document.documentElement.dataset.palette"), "gold");
    const uid = await a.evaluate("document.getElementById('door-user').value");
    await a.login(uid); await b.login(uid);
    assert.equal(await a.evaluate("document.getElementById('parameter-card') === null"), true);
    assert.equal(await a.evaluate("document.getElementById('legacy-count').textContent.includes('1 条旧历史')"), true);
    assert.equal(await a.evaluate("document.querySelectorAll('#history-list .record-row').length"), 0);
    assert.equal(await b.evaluate("document.getElementById('lintPrice').value"), "16987");
    const cookies = (await a.command("Network.getCookies", { urls: [base] })).cookies;
    assert.ok(cookies.some(cookie => cookie.name === "machine_session" && cookie.httpOnly && cookie.path === "/v2" && cookie.sameSite === "Strict"));
    await a.evaluate("for(let i=0;i<9;i++) document.getElementById('settings-trigger').click()");
    assert.equal(await a.evaluate("document.getElementById('unlock-dialog').open"), false);
    await a.click("settings-trigger"); await a.fill({ "unlock-password": "browser-level1-fixture" }); await a.submit("unlock-form");
    await a.until("document.getElementById('parameter-card') !== null"); await b.unlock("browser-level1-fixture");
    await a.edit("processingFee", "1200"); await b.edit("processingFee", "1300");
    await a.click("settings-tools"); await a.click("add-static-block");
    await a.evaluate("{const input=[...document.querySelectorAll('[data-template-text]')].at(-1);input.value='合成预览一致';input.dispatchEvent(new Event('change',{bubbles:true}));}");
    const preview = await a.evaluate("document.getElementById('template-preview').textContent");
    assert.ok(preview.includes("合成预览一致") && preview.includes("17187"));
    await a.click("save-cloud"); await a.until("document.getElementById('cloud-status').textContent.includes('已保存到服务器')");
    await b.click("settings-tools"); await b.click("save-cloud");
    await b.until("document.getElementById('settings-cloud-status').textContent.includes('其他会话修改')");
    await b.click("settings-close"); assert.equal(await b.evaluate("document.getElementById('processingFee').value"), "1300");
    await b.click("reload-cloud"); await b.until("document.getElementById('processingFee').value === '1200'");
    await a.click("settings-close"); await a.click("share-current");
    assert.equal(await a.evaluate("document.getElementById('share-preview').textContent"), preview); await a.click("share-close");
    await a.fill({ "record-note": "新用户本机方案" }); await a.click("compare-current");
    await a.until("document.querySelectorAll('#history-list .record-row').length === 1");
    assert.equal(await b.evaluate("document.querySelectorAll('#history-list .record-row').length"), 0);
    await a.command("Page.reload", { ignoreCache: true }); await a.ready();
    await a.until("!document.getElementById('calculator-content').hidden");
    assert.equal(await a.evaluate("document.getElementById('parameter-card') === null"), true);
    assert.equal(await a.evaluate("document.querySelectorAll('#history-list .record-row').length"), 1);
    assert.equal(await a.evaluate("localStorage.getItem('cottoncal.machine.v1')"), null);
    await b.unlock("browser-admin-fixture", "admin");
    assert.equal(await b.evaluate("document.getElementById('parameter-card') === null && !document.querySelector('#admin-dialog #template-list')"), true);
    await b.fill({ "new-user-name": "合成其他用户", "new-user-door": "browser-door-fixture", "new-user-door-confirm": "browser-door-fixture",
      "new-user-password": "browser-level1-fixture", "new-user-confirm": "browser-level1-fixture" });
    await b.submit("new-user-form"); await b.until("document.querySelectorAll('#admin-user-list .admin-user-row').length === 2");
    await a.click("switch-user"); await a.ready();
    const other = await a.evaluate("[...document.getElementById('door-user').options].find(x=>x.textContent==='合成其他用户').value");
    assert.notEqual(other, uid); await a.login(other);
    assert.equal(await a.evaluate("document.querySelectorAll('#history-list .record-row').length"), 0);
    assert.equal(await a.evaluate("document.getElementById('lintPrice').value"), "16987");
    await a.click("switch-user"); await a.ready(); await a.login(uid); await a.unlock("browser-level1-fixture"); await a.click("settings-tools");
    await a.fill({ "own-password-kind": "settings", "own-current-password": "browser-door-fixture",
      "own-new-password": "browser-level1-new-fixture", "own-confirm-password": "browser-level1-new-fixture" });
    await a.submit("own-password-form"); await a.until("document.getElementById('own-password-status').textContent.includes('密码不正确')");
    await a.fill({ "own-password-kind": "settings", "own-current-password": "browser-level1-fixture",
      "own-new-password": "browser-level1-new-fixture", "own-confirm-password": "browser-level1-new-fixture" });
    await a.submit("own-password-form"); await a.until("document.getElementById('door-status').textContent.includes('旧会话已撤销')");
    assert.equal(await b.evaluate("import('./js/app.js').then(m=>m.api.request('/admin/users').then(()=>200,e=>e.status))"), 401);
    await b.command("Page.reload", { ignoreCache: true }); await b.ready(); await b.unlock("browser-admin-fixture", "admin");
    await a.login(uid); await a.unlock("browser-level1-new-fixture");
    await a.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await a.edit("processingFee", "1400"); await a.click("settings-tools"); await a.click("save-cloud");
    await a.until("document.getElementById('settings-cloud-status').textContent.includes('未保存')");
    await a.click("settings-close"); await a.click("lock-settings");
    await a.evaluate("for(let i=0;i<10;i++) document.getElementById('settings-trigger').click()");
    await a.fill({ "unlock-password": "browser-level1-new-fixture" }); await a.submit("unlock-form");
    await a.until("document.getElementById('unlock-status').textContent.includes('无法连接')");
    assert.equal(await a.evaluate("document.getElementById('parameter-card') === null"), true); await a.click("unlock-cancel");
    await a.command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await a.click("reload-cloud"); await a.until("document.getElementById('cloud-status').textContent.includes('已读取最新配置')");
    assert.equal(await a.evaluate("import('./js/app.js').then(m=>m.api.request('/me/config')).then(x=>x.machine.processingFee)"), "1200");
    await b.evaluate("import('./js/app.js').then(m=>m.api.request('/admin/users/" + uid + "','PATCH',{enabled:false}))");
    await a.evaluate("window.dispatchEvent(new Event('focus'))"); await a.until("document.getElementById('calculator-content').hidden");
    await b.evaluate("import('./js/app.js').then(m=>m.api.request('/admin/users/" + uid + "','PATCH',{enabled:true}))");
    await b.fill({ "admin-current-password": "wrong-admin-fixture", "admin-new-password": "browser-admin-new-fixture", "admin-confirm-password": "browser-admin-new-fixture" });
    await b.submit("admin-credential-form"); await b.until("document.getElementById('admin-credential-status').textContent.includes('密码不正确')");
    await b.fill({ "admin-current-password": "browser-admin-fixture", "admin-new-password": "browser-admin-new-fixture", "admin-confirm-password": "browser-admin-new-fixture" });
    await b.submit("admin-credential-form"); await b.until("document.getElementById('door-status').textContent.includes('二级密码已更改')");
    await b.command("Page.reload", { ignoreCache: true }); await b.ready(); await b.unlock("browser-admin-new-fixture", "admin");
    assert.equal(await a.evaluate("(async()=>{for(const key of await caches.keys())for(const request of await(await caches.open(key)).keys())if(new URL(request.url).pathname.startsWith('/v2/api/'))return false;return true;})()"), true);
    assert.deepEqual(exceptions, []);
    console.log("BROWSER_CHECK_OK Edge 1280x900 two-independent-cookie-contexts real-local-API door ten-tap role-separation migration legacy-ledger UUID-isolation cloud-save conflict final-preview refresh-relock own-kind-password admin-password-rotation revocation offline-no-fallback API-no-cache calculation-history-comparison theme");
    }
  } finally {
    try { if (socket?.readyState === WebSocket.OPEN) await send("Browser.close"); } catch { /* exits */ }
    socket?.close(); await Promise.all([terminate(server), terminate(edge)]);
    for (const child of [server, edge]) { child.stdout.destroy(); child.stderr.destroy(); child.unref(); }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
