import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

test("静态预览仅公开资源，API返回维护且不公开后端/本机文件", async () => {
  const child = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, "")], {
    env: { ...process.env, PORT: "4189" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  try {
    const ready = once(child.stdout, "data");
    const exit = once(child, "exit").then(() => { throw new Error("Preview process exited before ready"); });
    await Promise.race([ready, exit]);
    const base = "http://127.0.0.1:4189";
    assert.equal((await fetch(base + "/v2/")).status, 200);
    assert.equal((await fetch(base + "/v2/js/cloud-client.js")).status, 200);
    const maintenance = await fetch(base + "/v2/api/session");
    assert.equal(maintenance.status, 503); assert.match(maintenance.headers.get("Cache-Control"), /no-store/);
    assert.match((await maintenance.json()).detail, /认证服务/);
    for (const path of ["/v2/test/static.test.js", "/v2/.env", "/v2/README.md", "/api/machine_api.py", "/v2/../PROJECT.md"]) {
      assert.equal((await fetch(base + path)).status, 404);
    }
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, "exit"); }
  }
});
