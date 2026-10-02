import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const edgePath = process.env.EDGE_PATH;
const screenshotPath = process.env.SCREENSHOT_PATH;
const serverPort = Number(process.env.BROWSER_CHECK_PORT ?? "4187");
const debugPort = Number(process.env.EDGE_DEBUG_PORT ?? "9222");
if (!edgePath && process.env.NODE_TEST_CONTEXT) {
  const { test } = await import("node:test");
  test("桌面浏览器检查需要显式 EDGE_PATH", { skip: true }, () => {});
} else {
if (!edgePath) throw new Error("EDGE_PATH is required");
const profile = resolve(root, "build", "browser-check-profile");
assert.equal(profile.startsWith(resolve(root, "build") + "\\"), true);
await rm(profile, { recursive: true, force: true });
await mkdir(profile, { recursive: true });
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(serverPort) },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
const edge = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  "--remote-debugging-address=127.0.0.1",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let edgeDiagnostics = "";
edge.stderr.on("data", (chunk) => { edgeDiagnostics += chunk.toString(); });
edge.stdout.on("data", (chunk) => { edgeDiagnostics += chunk.toString(); });

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function terminateProcessTree(child) {
  if (process.platform !== "win32") {
    child.kill();
    return;
  }
  const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolvePromise) => {
    killer.once("exit", resolvePromise);
    killer.once("error", resolvePromise);
  });
}

async function poll(url, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // The local process is still starting.
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

let socket;
let closeBrowser = async () => {};
try {
  await poll(`http://127.0.0.1:${serverPort}/`);
  try {
    await poll(`http://127.0.0.1:${debugPort}/json/version`);
  } catch (error) {
    throw new Error(`${error.message}; Edge exit=${edge.exitCode ?? "running"}; diagnostics=${edgeDiagnostics.slice(-1000)}`);
  }
  const targetResponse = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${serverPort}/?theme=light`)}`,
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve: resolvePromise, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolvePromise(message.result);
  });
  const send = (method, params = {}) => new Promise((resolvePromise, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  closeBrowser = async () => {
    try {
      await send("Browser.close");
    } catch {
      // The browser may close the protocol connection before acknowledging.
    }
  };
  const evaluate = async (expression) => {
    const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value;
  };
  const waitFor = async (expression, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (await evaluate(expression)) return;
      await wait(50);
    }
    throw new Error(`Timed out waiting for browser condition: ${expression}`);
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor("document.readyState === 'complete' && document.title === '机采棉成本换算'");
  assert.equal(await evaluate("document.title"), "机采棉成本换算");
  assert.equal(await evaluate("document.getElementById('parameter-card') === null"), true);
  assert.equal(await evaluate("document.getElementById('history-tab').getAttribute('aria-selected')"), "true");
  assert.equal(await evaluate("document.getElementById('comparison-count').textContent"), "0");
  await evaluate("document.getElementById('history-tab').focus(); document.getElementById('history-tab').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))")
  assert.equal(await evaluate("document.getElementById('comparison-tab').getAttribute('aria-selected')"), "true");
  assert.equal(await evaluate("document.activeElement.id"), "comparison-tab");
  assert.equal(await evaluate("document.getElementById('history-tab').tabIndex"), -1);
  await evaluate("document.getElementById('comparison-tab').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))")
  assert.equal(await evaluate("document.getElementById('history-tab').getAttribute('aria-selected')"), "true");
  assert.equal(await evaluate("document.activeElement.id"), "history-tab");

  await evaluate("for (let index = 0; index < 9; index += 1) document.getElementById('settings-trigger').click()")
  assert.equal(await evaluate("document.getElementById('unlock-dialog').open"), false);
  await evaluate("document.getElementById('settings-trigger').click()")
  assert.equal(await evaluate("document.getElementById('unlock-dialog').open"), true);
  assert.equal(await evaluate("document.activeElement.id"), "unlock-password");

  await evaluate(`import('./js/app.js').then((module) => {
    module.accessGate.authenticate = async (candidate) => candidate === 'admin-fixture'
      ? { type: 'admin' }
      : { type: 'user', id: 'browser-user', name: '浏览器检查用户' };
  })`);
  await evaluate("document.getElementById('unlock-password').value = 'ordinary-fixture'; document.getElementById('unlock-form').requestSubmit()")
  await waitFor("document.getElementById('parameter-card') !== null");
  assert.equal(await evaluate("document.getElementById('processingFee').value"), "1000");

  await evaluate("const input = document.getElementById('processingFee'); input.value = '1200'; input.dispatchEvent(new Event('input', { bubbles: true }))")
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('cottoncal.machine.v1')).machine.processingFee"), "1200");
  assert.equal(await evaluate("document.getElementById('lintPrice').value"), "17187");

  await evaluate("document.getElementById('record-note').value = '浏览器方案甲'; document.getElementById('compare-current').click()")
  await waitFor("document.querySelectorAll('#history-list .record-row').length === 1");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('cottoncal.machine.history.v1')).records.length"), 1);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('cottoncal.machine.comparison.v1')).recordIds.length"), 1);
  assert.equal(await evaluate("document.getElementById('comparison-count').textContent"), "1");
  await evaluate("document.getElementById('comparison-tab').click()")
  assert.equal(await evaluate("document.getElementById('comparison-panel').hidden"), false);
  assert.equal(await evaluate("document.querySelectorAll('#comparison-list .comparison-row').length"), 1);
  assert.equal(await evaluate("document.querySelector('#comparison-list .price-delta-track') !== null"), true);
  assert.equal(await evaluate("document.querySelector('#comparison-list .price-delta-label span').textContent"), "籽棉单价差");
  assert.equal(await evaluate("document.querySelector('#comparison-list .price-delta-label strong').textContent"), "相同");
  assert.equal(await evaluate("document.querySelector('#comparison-list .price-delta-track i').style.left"), "50%");
  await evaluate("document.querySelector('#comparison-list [data-action=remove]').click()")
  await waitFor("document.getElementById('comparison-count').textContent === '0'");
  assert.equal(await evaluate("document.getElementById('ledger-status').textContent.includes('已从方案对比移除')"), true);
  assert.equal(await evaluate("document.activeElement.id"), "comparison-tab");
  await evaluate("document.getElementById('history-tab').click()")
  assert.equal(await evaluate("document.querySelector('#history-list [data-action=compare]').getAttribute('aria-label').includes('浏览器方案甲')"), true);
  await evaluate("document.querySelector('#history-list [data-action=compare]').click()")
  await waitFor("document.getElementById('comparison-count').textContent === '1'");
  assert.equal(await evaluate("document.getElementById('ledger-status').textContent.includes('已加入方案对比')"), true);
  assert.equal(await evaluate("document.activeElement.dataset.action"), "compare");
  await evaluate("document.getElementById('history-tab').click(); document.querySelector('#history-list [data-action=share]').click()")
  await waitFor("document.getElementById('share-dialog').open");
  assert.equal(await evaluate("document.getElementById('share-preview').textContent.includes('测算日期：')"), true);
  assert.equal(await evaluate("document.getElementById('share-preview').textContent.includes('现货价格：17187元/吨')"), true);
  await evaluate("document.getElementById('share-close').click()")

  await evaluate(`for (let index = 1; index <= 31; index += 1) {
    document.getElementById('record-note').value = '分页记录' + index;
    document.getElementById('save-record').click();
  }`)
  await waitFor("JSON.parse(localStorage.getItem('cottoncal.machine.history.v1')).records.length === 32");
  assert.equal(await evaluate("document.querySelectorAll('#history-list .record-row').length"), 30);
  assert.equal(await evaluate("document.getElementById('history-load-more').hidden"), false);
  await evaluate("document.getElementById('history-load-more').focus(); document.getElementById('history-load-more').click()")
  assert.equal(await evaluate("document.getElementById('history-load-more').hidden"), true);
  assert.equal(await evaluate("document.activeElement.closest('.record-row') !== null && Boolean(document.activeElement.dataset.action)"), true);
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label').includes('列表第 31 条')"), true);
  await evaluate("document.getElementById('history-load-more').dispatchEvent(new MouseEvent('click', { bubbles: true }))")
  assert.equal(await evaluate("document.activeElement.id"), "history-query");

  await evaluate("for (let index = 0; index < 10; index += 1) document.getElementById('settings-trigger').click()")
  await waitFor("document.getElementById('unlock-dialog').open");
  await evaluate("document.getElementById('unlock-password').value = 'admin-fixture'; document.getElementById('unlock-form').requestSubmit()")
  await waitFor("document.getElementById('admin-dialog').open");
  assert.equal(await evaluate("document.querySelectorAll('#admin-user-list .admin-user-row').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('#template-list .template-row').length >= 12"), true);
  assert.equal(await evaluate("document.querySelector('#admin-user-list [data-action=toggle-user]').getAttribute('aria-label').includes('FYX')"), true);
  await evaluate(`window.__originalVerifier = JSON.parse(localStorage.getItem('cottoncal.machine.users.v1')).users[0].verifierBase64;
    document.getElementById('new-user-name').value = 'FYX';
    document.getElementById('new-user-password').value = 'browser-new-fixture';
    document.querySelector('#admin-user-list [data-user-password]').value = 'browser-blocked-reset-fixture';
    document.getElementById('new-user-form').requestSubmit();
    document.getElementById('new-user-form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    document.querySelector('#admin-user-list [data-action=reset-user]').dispatchEvent(new MouseEvent('click', { bubbles: true }));`)
  assert.equal(await evaluate("document.getElementById('user-admin-section').getAttribute('aria-busy')"), "true");
  assert.equal(await evaluate("[...document.querySelectorAll('#user-admin-section input, #user-admin-section button')].every((control) => control.disabled)"), true);
  await waitFor("document.getElementById('user-admin-section').getAttribute('aria-busy') === 'false' && JSON.parse(localStorage.getItem('cottoncal.machine.users.v1')).users.length === 2", 300);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('cottoncal.machine.users.v1')).users[0].verifierBase64 === window.__originalVerifier"), true);
  assert.equal(await evaluate("new Set([...document.querySelectorAll('#admin-user-list [data-action=toggle-user]')].map((node) => node.getAttribute('aria-label'))).size"), 2);
  assert.equal(await evaluate("[...document.querySelectorAll('#admin-user-list [data-action=toggle-user]')].every((node) => /列表第 [12] 位/.test(node.getAttribute('aria-label')))"), true);
  await evaluate("document.querySelector('#admin-user-list [data-user-password]').value = 'browser-reset-after-release-fixture'; document.querySelector('#admin-user-list [data-action=reset-user]').click()")
  await waitFor("document.getElementById('user-admin-section').getAttribute('aria-busy') === 'false' && JSON.parse(localStorage.getItem('cottoncal.machine.users.v1')).users[0].verifierBase64 !== window.__originalVerifier", 300);
  assert.equal(await evaluate("document.getElementById('user-admin-status').textContent.includes('用户密码已重置')"), true);
  await evaluate("document.querySelector('#admin-user-list [data-action=toggle-user]').click()")
  assert.equal(await evaluate("document.activeElement.dataset.action"), "toggle-user");
  assert.equal(await evaluate("document.getElementById('user-admin-status').textContent.includes('用户已停用')"), true);
  await evaluate("document.getElementById('add-divider-block').click(); document.getElementById('add-divider-block').click(); document.getElementById('add-static-block').click(); document.getElementById('add-static-block').click()")
  assert.equal(await evaluate(`(() => {
    const labels = [...document.querySelectorAll('#template-list [data-action=remove-block]')]
      .map((node) => node.getAttribute('aria-label')).filter((label) => label.includes('分隔线模块'));
    return labels.length >= 2 && new Set(labels).size === labels.length && labels.every((label) => /模板第 \\d+ 项/.test(label));
  })()`), true);
  assert.equal(await evaluate(`(() => {
    const labels = [...document.querySelectorAll('#template-list [data-action=remove-block]')]
      .map((node) => node.getAttribute('aria-label')).filter((label) => label.includes('静态文字模块“新增文字”'));
    return labels.length >= 2 && new Set(labels).size === labels.length && labels.every((label) => /模板第 \\d+ 项/.test(label));
  })()`), true);
  assert.equal(await evaluate("document.querySelector('#template-list [data-template-visible]').getAttribute('aria-label').includes('模块')"), true);
  await evaluate("document.querySelector('#template-list [data-template-visible]').click()")
  assert.equal(await evaluate("document.activeElement.hasAttribute('data-template-visible')"), true);
  await evaluate("document.getElementById('admin-exit').click()")
  await waitFor("!document.getElementById('admin-dialog').open && document.getElementById('parameter-card') === null");

  await evaluate("document.getElementById('theme-button').click(); document.querySelector('[data-palette=gold]').click()")
  assert.equal(await evaluate("document.documentElement.dataset.palette"), "gold");
  await evaluate("document.getElementById('theme-dialog').close()")

  if (screenshotPath) {
    await evaluate("document.getElementById('comparison-tab').click()")
    const capture = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    await writeFile(screenshotPath, Buffer.from(capture.data, "base64"));
    await evaluate("document.getElementById('history-tab').click()")
  }

  await send("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete'");
  await waitFor("document.getElementById('seedCottonPrice').value !== ''");
  assert.equal(await evaluate("document.getElementById('parameter-card') === null"), true);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('cottoncal.machine.v1')).machine.processingFee"), "1200");
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('cottoncal.machine.history.v1')).records.length"), 32);
  assert.equal(await evaluate("document.querySelectorAll('#history-list .record-row').length"), 30);
  assert.equal(await evaluate("localStorage.getItem('cottoncal.machine.users-initialized.v1') !== null"), true);
  assert.equal(await evaluate("document.documentElement.dataset.palette"), "gold");

  await evaluate(`(async () => {
    const [{ createPasswordCredential }, { serializeAdminCredential }] = await Promise.all([
      import('./js/users.js'), import('./js/admin-credential.js'),
    ]);
    const credential = await createPasswordCredential('browser-admin-old-fixture');
    localStorage.setItem('cottoncal.machine.admin-credential.v1', serializeAdminCredential(credential));
  })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete' && document.getElementById('seedCottonPrice').value !== ''");
  assert.equal(await evaluate("document.getElementById('admin-dialog').open"), false);
  assert.equal(await evaluate("document.getElementById('parameter-card') === null"), true);
  await evaluate("window.__lockedAdminSerialized = localStorage.getItem('cottoncal.machine.admin-credential.v1')")
  await evaluate(`document.getElementById('admin-current-password').value = 'browser-admin-old-fixture';
    document.getElementById('admin-new-password').value = 'browser-admin-blocked-fixture';
    document.getElementById('admin-confirm-password').value = 'browser-admin-blocked-fixture';
    document.getElementById('admin-credential-form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));`);
  assert.equal(await evaluate("document.getElementById('admin-credential-status').textContent"), "");
  assert.equal(await evaluate("localStorage.getItem('cottoncal.machine.admin-credential.v1') === window.__lockedAdminSerialized"), true);

  await evaluate("document.getElementById('admin-credential-form').reset(); for (let index = 0; index < 10; index += 1) document.getElementById('settings-trigger').click()")
  await waitFor("document.getElementById('unlock-dialog').open");
  await evaluate("document.getElementById('unlock-password').value = 'browser-admin-old-fixture'; document.getElementById('unlock-form').requestSubmit()")
  await waitFor("document.getElementById('admin-dialog').open");
  assert.equal(await evaluate("['admin-current-password', 'admin-new-password', 'admin-confirm-password'].every((id) => document.getElementById(id).type === 'password')"), true);
  assert.equal(await evaluate("document.getElementById('admin-credential-section').textContent.includes('当前浏览器')"), true);

  await evaluate(`document.getElementById('admin-current-password').value = 'browser-wrong-old-fixture';
    document.getElementById('admin-new-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-confirm-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-credential-form').requestSubmit();`);
  await waitFor("document.getElementById('admin-credential-status').textContent.includes('当前管理员密码不正确')");
  assert.equal(await evaluate("['admin-current-password', 'admin-new-password', 'admin-confirm-password'].every((id) => document.getElementById(id).value === '')"), true);
  await evaluate(`document.getElementById('admin-current-password').value = 'browser-admin-old-fixture';
    document.getElementById('admin-new-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-confirm-password').value = 'browser-admin-other-fixture';
    document.getElementById('admin-credential-form').requestSubmit();`);
  await waitFor("document.getElementById('admin-credential-status').textContent.includes('不一致')");
  await evaluate(`document.getElementById('admin-current-password').value = 'browser-admin-old-fixture';
    document.getElementById('admin-new-password').value = 'browser-new-fixture';
    document.getElementById('admin-confirm-password').value = 'browser-new-fixture';
    document.getElementById('admin-credential-form').requestSubmit();`);
  await waitFor("document.getElementById('admin-credential-status').textContent.includes('普通用户')");

  await evaluate(`window.__adminOriginalSerialized = localStorage.getItem('cottoncal.machine.admin-credential.v1');
    window.__originalStorageSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'cottoncal.machine.admin-credential.v1') throw new Error('fixture-write-denied');
      return window.__originalStorageSetItem.call(this, key, value);
    };
    document.getElementById('admin-current-password').value = 'browser-admin-old-fixture';
    document.getElementById('admin-new-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-confirm-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-credential-form').requestSubmit();`);
  await waitFor("document.getElementById('admin-credential-status').textContent.includes('浏览器存储失败')", 300);
  assert.equal(await evaluate("localStorage.getItem('cottoncal.machine.admin-credential.v1') === window.__adminOriginalSerialized"), true);
  await evaluate("Storage.prototype.setItem = window.__originalStorageSetItem")

  await evaluate(`document.getElementById('admin-current-password').value = 'browser-admin-old-fixture';
    document.getElementById('admin-new-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-confirm-password').value = 'browser-admin-new-fixture';
    document.getElementById('admin-credential-form').requestSubmit();
    document.getElementById('admin-credential-form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));`);
  assert.equal(await evaluate("document.getElementById('admin-credential-section').getAttribute('aria-busy')"), "true");
  assert.equal(await evaluate("document.getElementById('user-admin-section').getAttribute('aria-busy')"), "true");
  assert.equal(await evaluate("document.getElementById('admin-exit').disabled"), true);
  await waitFor("document.getElementById('admin-credential-status').textContent.includes('当前浏览器保存')", 300);
  assert.equal(await evaluate("localStorage.getItem('cottoncal.machine.admin-credential.v1') !== window.__adminOriginalSerialized"), true);
  assert.equal(await evaluate("!localStorage.getItem('cottoncal.machine.admin-credential.v1').includes('browser-admin-new-fixture')"), true);
  await evaluate(`document.getElementById('new-user-name').value = '冲突测试';
    document.getElementById('new-user-password').value = 'browser-admin-new-fixture';
    document.getElementById('new-user-form').requestSubmit();`);
  await waitFor("document.getElementById('user-admin-status').textContent.includes('管理员密码相同')", 300);

  await evaluate("document.getElementById('admin-exit').click()")
  await waitFor("!document.getElementById('admin-dialog').open && document.getElementById('parameter-card') === null");
  await send("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete' && document.getElementById('seedCottonPrice').value !== ''");
  await evaluate("for (let index = 0; index < 10; index += 1) document.getElementById('settings-trigger').click()")
  await waitFor("document.getElementById('unlock-dialog').open");
  await evaluate("document.getElementById('unlock-password').value = 'browser-admin-old-fixture'; document.getElementById('unlock-form').requestSubmit()")
  await waitFor("document.getElementById('unlock-status').textContent.includes('密码不正确')", 300);
  assert.equal(await evaluate("document.getElementById('admin-dialog').open"), false);
  await evaluate("document.getElementById('unlock-password').value = 'browser-admin-new-fixture'; document.getElementById('unlock-form').requestSubmit()")
  await waitFor("document.getElementById('admin-dialog').open", 300);
  assert.equal(await evaluate("document.querySelectorAll('#admin-user-list .admin-user-row').length"), 2);
  await evaluate("document.getElementById('admin-exit').click()")
  await waitFor("!document.getElementById('admin-dialog').open && document.getElementById('parameter-card') === null");

  console.log("BROWSER_CHECK_OK 1280x900 locked keyboard-tabs injected-user parameters ledger-live focus-restore load-more-end-focus seed-price-comparison share second-ten-tap admin user-mutation-gate admin-password-rotation storage-failure collision reload-old-rejected-new-accepted contextual-aria exit-relock persistence reload-relock theme");
} finally {
  await closeBrowser();
  await wait(700);
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  await Promise.all([terminateProcessTree(server), terminateProcessTree(edge)]);
  server.stdout.destroy();
  server.stderr.destroy();
  edge.stdout.destroy();
  edge.stderr.destroy();
  server.unref();
  edge.unref();
  await wait(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
}
