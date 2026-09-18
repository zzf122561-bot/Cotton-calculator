import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("HTML 包含正确联系入口、棉花图片、说明与主题控制", () => {
  const html = read("index.html");
  assert.match(html, /href="tel:13212730826"/);
  assert.match(html, /href="mailto:zzf8640283@126\.com\?subject=%E7%9A%AE%E6%A3%89/);
  assert.match(html, /<img src="\.\/assets\/author_wechat_qr\.jpg"[^>]+>/);
  assert.match(html, /<img src="\.\/assets\/cotton-boll\.png" alt="">/);
  assert.doesNotMatch(html, /离线计算 · 数据只保存在本机/);
  assert.doesNotMatch(html, /精确十进制计算 · 仅显示时四舍五入/);
  assert.match(html, /rel="apple-touch-icon" href="\.\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /id="guide-button"[^>]*>使用说明<\/button>/);
  assert.match(html, /id="theme-button"[^>]*>主题<\/button>/);
  assert.match(html, /id="copy-inquiry"[^>]*>复制测算摘要<\/button>/);
  assert.equal((html.match(/\.\/assets\/guide\/step-[1-4]-[^"]+\.png/g) ?? []).length, 4);
  assert.doesNotMatch(read("styles.css"), /-webkit-touch-callout\s*:\s*none/);
});

test("Manifest 定义 standalone、相对范围及 192/512 图标", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.deepEqual(manifest.icons.map((icon) => icon.sizes), ["192x192", "512x512"]);
  for (const icon of manifest.icons) assert.ok(existsSync(resolve(root, icon.src.replace(/^\.\//, ""))));
});

test("Service Worker 预缓存清单与全部运行时静态文件一致", () => {
  const worker = read("sw.js");
  const block = worker.match(/\/\/ PRECACHE_START([\s\S]*?)\/\/ PRECACHE_END/)[1];
  const listed = [...block.matchAll(/"(\.\/[^"\n]*)"/g)].map((match) => match[1]).sort();
  const expected = [
    "./", "./index.html", "./styles.css", "./manifest.webmanifest", "./js/app.js", "./js/calculator.js",
    "./js/decimal.js", "./js/storage.js", "./js/theme.js", "./js/inquiry.js",
    "./assets/cotton-boll.png", "./assets/author_wechat_qr.jpg",
    "./assets/guide/step-1-preset.png", "./assets/guide/step-2-price.png",
    "./assets/guide/step-3-details.png", "./assets/guide/step-4-inquiry.png", "./icons/icon-192.png",
    "./icons/icon-512.png", "./icons/apple-touch-icon.png",
  ].sort();
  assert.deepEqual(listed, expected);
  for (const url of listed.filter((url) => url !== "./")) assert.ok(existsSync(resolve(root, url.slice(2))), url);
  assert.match(worker, /caches\.delete/);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(worker, /clients\.claim/);
});

test("系统深浅色与确定性预览主题均有样式入口", () => {
  const css = read("styles.css");
  const app = read("js/app.js");
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /:root\[data-theme="dark"\]/);
  assert.match(css, /:root\[data-palette="gold"\]/);
  assert.match(css, /:root\[data-palette="custom"\]/);
  assert.match(app, /URLSearchParams\(window\.location\.search\)/);
});

test("本地服务器为 SVG 提供正确 MIME 类型", () => {
  assert.match(read("server.mjs"), /"\.svg": "image\/svg\+xml; charset=utf-8"/);
});

test("PNG 图标文件头尺寸正确", () => {
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const bytes = readFileSync(resolve(root, "icons", name));
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});
