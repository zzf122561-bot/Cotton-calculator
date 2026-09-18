import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(resolve(root, name), "utf8");

test("手机与服务器交付说明明确 HTTPS、安装和隐私边界", () => {
  const mobile = read("deployment/MOBILE_USE.md");
  const server = read("deployment/SERVER_HANDOFF.md");
  assert.match(mobile, /添加到主屏幕/);
  assert.match(mobile, /__PUBLIC_URL__/);
  assert.match(mobile, /不能注册 Service Worker/);
  assert.match(server, /纯静态 PWA/);
  assert.match(server, /没有操作任何服务器或域名/);
  assert.match(server, /不埋点、不自动上报/);
});

test("交付构建脚本包含当前包、平铺归档和版本索引", () => {
  const script = read("scripts/build-deliverables.ps1");
  assert.match(script, /cottoncal-mobile-v\$Version\.zip/);
  assert.match(script, /cottoncal-server-handoff-v\$Version\.zip/);
  assert.match(script, /yyyyMMdd-HHmmss/);
  assert.match(script, /archive\\VERSIONS\.md|Join-Path \$archiveRoot 'VERSIONS\.md'/);
  assert.doesNotMatch(script, /New-Item[^\n]+\$timestamp/);
  assert.ok(existsSync(resolve(root, "deliverables/archive/VERSIONS.md")));
});

test("服务器交接文件和移动配置模板齐全", () => {
  for (const name of [
    "deployment/DEPLOYMENT_CHECKLIST.md",
    "deployment/nginx-cottoncal.conf.example",
    "deployment/mobile-webclip.mobileconfig.template",
  ]) {
    assert.ok(existsSync(resolve(root, name)), name);
  }
  assert.match(read("deployment/mobile-webclip.mobileconfig.template"), /com\.apple\.webClip\.managed/);
});
