import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manager = resolve(root, "_manager");
const readManager = (name) => readFileSync(resolve(manager, name), "utf8");

test("new packaging is manager-owned and desktop-only", () => {
  const script = readManager("scripts/build-desktop-web.ps1");
  assert.match(script, /ValidateSet\('test', 'release'\)/);
  assert.match(script, /Refusing to overwrite existing package/);
  assert.match(script, /packageSha256/);
  assert.doesNotMatch(script, /cottoncal-mobile|MOBILE_USE|mobile-webclip/);
  assert.ok(existsSync(resolve(manager, "legacy/web/build-deliverables-v1.1.0.ps1")));
});

test("desktop handoff template and checklist are manager-owned", () => {
  const handoff = readManager("templates/web/SERVER_HANDOFF.md");
  assert.match(handoff, /__VERSION__/);
  assert.match(handoff, /__SOURCE_COMMIT__/);
  assert.match(handoff, /纯静态 PWA/);
  assert.ok(existsSync(resolve(manager, "templates/web/DEPLOYMENT_CHECKLIST.md")));
  assert.ok(existsSync(resolve(manager, "templates/web/nginx-cottoncal.conf.example")));
});

test("historical Android and web packages retain their recorded SHA-256", () => {
  const expected = new Map([
    ["releases/android/v1.0.0/皮棉成本换算-v1.0.0.apk", "1a90b921783fb980e9238f73c9efb88aacd7f4e32b1ba8503f4a59e4b6494ff5"],
    ["releases/android/v1.0.1/CottonCal-v1.0.1-release.apk", "9679f24cbc1e0103948f96c43c332b209e3fd180c3536805224eb920908fadbf"],
    ["releases/web/v1.1.0/cottoncal-mobile-v1.1.0.zip", "62667bdaf1ea6045a9f4babd8405ba83da0a9c15ed0a629d7dc9bcc9cba260e8"],
    ["releases/web/v1.1.0/cottoncal-server-handoff-v1.1.0.zip", "32fa334646475dad47c0e719bcfe6d8ae275c54ccfe601659823df14cf17a394"],
  ]);
  for (const [name, sha] of expected) {
    const bytes = readFileSync(resolve(manager, name));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha, name);
  }
});
