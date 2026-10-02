import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("HTML 使用独立产品名并保留顶部、说明、主题、联系作者、价格桥和方案账本", () => {
  const html = read("index.html");
  assert.match(html, /<title>机采棉成本换算<\/title>/);
  assert.match(html, /<h1>机采棉成本换算<\/h1>/);
  assert.match(html, /id="settings-trigger"/);
  assert.match(html, /<img src="\.\/assets\/cotton-boll\.png" alt="">/);
  assert.match(html, /id="guide-button"[^>]*>使用说明<\/button>/);
  assert.match(html, /id="theme-button"[^>]*>主题<\/button>/);
  assert.match(html, /id="contact-button"[^>]*>联系作者<\/button>/);
  assert.match(html, /<h2>价格桥<\/h2>/);
  assert.match(html, /id="save-record"[^>]*>保存记录<\/button>/);
  assert.match(html, /id="history-tab"[^>]*aria-selected="true"/);
  assert.match(html, /id="comparison-tab"/);
  assert.match(html, /id="share-dialog"/);
  assert.match(html, /id="admin-dialog"/);
  assert.match(html, /href="tel:13212730826"/);
  assert.match(html, /<img src="\.\/assets\/author_wechat_qr\.jpg"[^>]+>/);
});

test("锁定 HTML 不包含参数字段，运行时才创建参数节点", () => {
  const html = read("index.html");
  const app = read("js/app.js");
  for (const field of ["lintPercentage", "lossPercentage", "cottonseedPrice", "processingFee", "laborFee", "warehouseFee", "financeFee", "subsidy"]) {
    assert.doesNotMatch(html, new RegExp(`id="${field}"`));
  }
  assert.match(app, /function createParameterCard\(\)/);
  assert.match(app, /parameterMount\.replaceChildren\(card\)/);
});

test("衍生版静态源码移除手摘棉、旧右侧功能、重置、载入和导入导出", () => {
  const sources = ["index.html", "js/app.js", "js/calculator.js", "js/storage.js", "js/records.js", "sw.js"]
    .map(read)
    .join("\n");
  for (const forbidden of [
    "手摘棉", "selectedPreset", "detailsExpanded", "计算明细", "采购沟通", "复制测算摘要", "发邮件询价", "恢复默认值",
    "载入", "导入", "导出",
    "cottoncal.pwa.v1", "cottoncal-pwa-",
  ]) {
    assert.equal(sources.includes(forbidden), false, forbidden);
  }
  assert.match(read("js/storage.js"), /cottoncal\.machine\.v1/);
  assert.match(read("sw.js"), /cottoncal-machine-v1-/);
});

test("Manifest 定义独立身份、相对范围及 192 和 512 图标", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.id, "./machine-cottoncal");
  assert.equal(manifest.name, "机采棉成本换算");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.theme_color, "#595e63");
  assert.match(read("styles.css"), /--green: #595e63;/);
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) assert.ok(existsSync(resolve(root, icon.src.replace(/^\.\//, ""))));
});

test("Service Worker 预缓存清单覆盖全部运行时文件", () => {
  const worker = read("sw.js");
  const block = worker.match(/\/\/ PRECACHE_START([\s\S]*?)\/\/ PRECACHE_END/)[1];
  const listed = [...block.matchAll(/"(\.\/[^"\n]*)"/g)].map((match) => match[1]).sort();
  const expected = [
    "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./js/app.js", "./js/access-control.js", "./js/admin-credential.js",
    "./js/calculator.js", "./js/decimal.js", "./js/ledger-storage.js", "./js/records.js", "./js/sharing.js",
    "./js/storage.js", "./js/theme.js", "./js/users.js",
    "./assets/cotton-boll.png", "./assets/author_wechat_qr.jpg", "./icons/icon-192.png",
    "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  ].sort();
  assert.deepEqual(listed, expected);
  for (const url of listed.filter((url) => url !== "./")) assert.ok(existsSync(resolve(root, url.slice(2))), url);
  assert.match(worker, /caches\.delete/);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(worker, /clients\.claim/);
  assert.match(worker, /cottoncal-machine-v1-20261001-1/);
});

test("访问控制保持密码遮罩，内置材料不变且源码无明文口令日志", () => {
  const html = read("index.html");
  const access = read("js/access-control.js");
  const adminCredential = read("js/admin-credential.js");
  const app = read("js/app.js");
  assert.match(html, /id="unlock-password" type="password"/);
  assert.match(html, /id="new-user-password" type="password"/);
  for (const id of ["admin-current-password", "admin-new-password", "admin-confirm-password"]) {
    assert.match(html, new RegExp(`id="${id}" type="password"`));
  }
  assert.match(html, /id="admin-credential-section"[^>]*aria-busy="false"/);
  assert.match(html, /仅保存在当前浏览器的本站数据中/);
  assert.match(html, /清除本站浏览器数据后/);
  assert.match(access, /ADMIN_VERIFIER_CONFIG/);
  assert.doesNotMatch(`${access}\n${adminCredential}\n${app}\n${html}`, /ADMIN_PASSWORD\s*=|console\.(?:log|debug).*password/i);
});

test("历史列表限制单次渲染数量并提供继续访问入口", () => {
  const app = read("js/app.js");
  const records = read("js/records.js");
  assert.match(records, /HISTORY_PAGE_SIZE = 30/);
  assert.match(app, /filtered\.slice\(0, historyRenderLimit\)/);
  assert.match(app, /historyRenderLimit \+= HISTORY_PAGE_SIZE/);
  assert.match(app, /firstNewRecordId/);
  assert.match(app, /if \(historyLoadMore\.hidden\)/);
  assert.match(app, /historyQuery\.focus\(\)/);
  assert.match(read("index.html"), /id="history-load-more"/);
});

test("普通用户新增和重置共享挂起锁并暴露忙碌状态", () => {
  const html = read("index.html");
  const app = read("js/app.js");
  const users = read("js/users.js");
  assert.match(html, /id="user-admin-section"[^>]*aria-busy="false"/);
  assert.match(users, /class UserMutationGate/);
  assert.match(users, /if \(this\.userMutationPending\) return \{ entered: false \}/);
  assert.match(app, /userMutationGate\.run/);
  assert.match(app, /section\.setAttribute\("aria-busy", String\(pending\)\)/);
  assert.match(app, /control\.disabled = pending/);
  assert.match(app, /if \(userMutationGate\.userMutationPending\)/);
});

test("方案账本状态、键盘标签和重复操作具备可访问上下文", () => {
  const html = read("index.html");
  const app = read("js/app.js");
  assert.match(html, /id="ledger-status"[^>]*aria-live="polite"/);
  assert.match(html, /id="history-tab"[^>]*tabindex="0"/);
  assert.match(html, /id="comparison-tab"[^>]*tabindex="-1"/);
  assert.match(app, /event\.key === "ArrowRight"/);
  assert.match(app, /event\.key === "ArrowLeft"/);
  assert.match(app, /event\.key === "Home"/);
  assert.match(app, /event\.key === "End"/);
  assert.match(app, /setAttribute\("aria-label"/);
  assert.match(app, /保存于 \$\{formatRecordDateTime\(record\.savedAt\)\}，列表第/);
  assert.match(app, /用户“\$\{user\.name\}”（列表第/);
  assert.match(app, /模板第 \$\{index \+ 1\} 项/);
  assert.match(app, /focusTemplateControl/);
  assert.match(html, /籽棉单价差/);
  assert.doesNotMatch(`${html}\n${app}`, /皮棉价差/);
});

test("主题、键盘焦点和减少动态效果均保留", () => {
  const css = read("styles.css");
  const app = read("js/app.js");
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /:root\[data-palette="gold"\]/);
  assert.match(css, /:root\[data-palette="custom"\]/);
  assert.match(app, /URLSearchParams\(window\.location\.search\)/);
});

test("本地服务器与 PNG 图标结构有效", () => {
  assert.match(read("server.mjs"), /"\.svg": "image\/svg\+xml; charset=utf-8"/);
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const bytes = readFileSync(resolve(root, "icons", name));
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
