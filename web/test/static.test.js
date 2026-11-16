import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("独立产品身份、用户门板及两级管理入口", () => {
  const html = read("index.html");
  assert.match(html, /<title>机采棉成本换算<\/title>/);
  for (const id of ["door-panel", "door-user", "door-password", "settings-trigger", "settings-dialog", "admin-dialog", "template-preview", "legacy-ledger"]) assert.ok(html.includes('id="' + id + '"'));
  assert.match(html, /id="door-password" type="password"/);
  assert.match(html, /id="calculator-content" hidden/);
  assert.doesNotMatch(html, /id="processingFee"/);
});

test("静态网页无真实 verifier、本机鉴权回退或本机配置保存", () => {
  const app = read("js/app.js"), access = read("js/access-control.js");
  assert.doesNotMatch(app + access, /verifierBase64|ADMIN_VERIFIER_CONFIG|verifyAdminPassword|authenticateAuthorizedUser/);
  assert.doesNotMatch(app, /loadState|saveState|loadAdminCredential/);
  assert.equal(existsSync(resolve(root, "js/admin-credential.js")), false);
  assert.equal(existsSync(resolve(root, "js/users.js")), false);
});

test("API 从 Service Worker 缓存排除，运行时模块预缓存完整", () => {
  const worker = read("sw.js");
  assert.match(worker, /pathname\.startsWith\("\/v2\/api\/"\)/);
  const block = worker.match(/\/\/ PRECACHE_START([\s\S]*?)\/\/ PRECACHE_END/)[1];
  const urls = [...block.matchAll(/"(\.\/[^"\n]*)"/g)].map((match) => match[1]);
  assert.ok(urls.includes("./js/cloud-client.js"));
  for (const url of urls.filter((url) => url !== "./")) assert.ok(existsSync(resolve(root, url.slice(2))));
  assert.match(worker, /cloud-20261003/);
});

test("默认系统色与银灰主题一致，保持银金自选色和键盘支持", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.id, "./machine-cottoncal");
  assert.equal(manifest.theme_color, "#595e63");
  const css = read("styles.css");
  for (const pattern of [/:focus-visible/, /prefers-reduced-motion/, /data-palette="gold"/, /data-palette="custom"/]) assert.match(css, pattern);
  const app = read("js/app.js");
  assert.match(app, /ArrowRight/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /historyRenderLimit \+= HISTORY_PAGE_SIZE/);
});

test("分享编辑与实际分享共用渲染器并显示最终文本", () => {
  const app = read("js/app.js");
  assert.match(app, /renderShareText\(currentSnapshotForSharing\(\), shareTemplate\)/);
  assert.match(app, /renderShareText\(record, shareTemplate\)/);
  assert.match(app, /configDirty/);
  assert.match(app, /refreshConfig/);
});

test("图标与作者资源保留", () => {
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const bytes = readFileSync(resolve(root, "icons", name));
    assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
  }
  assert.match(read("index.html"), /href="tel:13212730826"/);
  assert.ok(existsSync(resolve(root, "assets/author_wechat_qr.jpg")));
});
