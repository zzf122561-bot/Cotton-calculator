import test from "node:test";
import assert from "node:assert/strict";
import { Api, LatestIntent, compareSeed, seedDifference } from "../factory/shared.js";

const plan = (n, d = "100") => ({ exactSeed: { n, d } });

test("factory comparison uses exact rational prices beyond rounded labels", () => {
  assert.equal(compareSeed(plan("73001", "10000"), plan("73002", "10000")), -1);
  assert.equal(compareSeed(plan("73", "10"), plan("730", "100")), 0);
  assert.equal(seedDifference(plan("750"), plan("730")), "0.20");
  assert.equal(seedDifference(plan("730"), plan("750")), "-0.20");
  assert.equal(seedDifference(plan("1461", "200"), plan("730")), "0.01");
});

test("late response cannot claim a newer input intent", async () => {
  const gate = new LatestIntent();
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const older = gate.invalidate();
  const oldRequest = waiting.then(() => gate.isCurrent(older));
  const newer = gate.invalidate();
  assert.equal(gate.isCurrent(newer), true);
  release();
  assert.equal(await oldRequest, false);
  gate.invalidate(); // switching factory or going offline invalidates pending work as well
  assert.equal(gate.isCurrent(newer), false);
});

test("client carries CSRF and same-origin credentials without caching", async () => {
  const requests = [];
  const api = new Api(false, async (path, init) => {
    requests.push({ path, init });
    return { ok: true, json: async () => ({ csrf: "synthetic-csrf" }) };
  });
  await api.call("/session");
  await api.call("/join", "POST", { code: "12345678", phone: "13800000000" });
  assert.equal(requests[1].path, "/v2/factory-api/join");
  assert.equal(requests[1].init.cache, "no-store");
  assert.equal(requests[1].init.credentials, "same-origin");
  assert.equal(requests[1].init.headers["X-CSRF-Token"], "synthetic-csrf");
  assert.equal(new Api(true, async () => {}).prefix, "/v2/factory-api/manage");
});

test("network and non-JSON failures never become successful calculations", async () => {
  const offline = new Api(false, async () => { throw new Error("offline"); });
  await assert.rejects(() => offline.call("/calculate", "POST", {}), /网络未连接/);
  const maintenance = new Api(false, async () => ({ ok: false, status: 503, json: async () => { throw new Error(); } }));
  await assert.rejects(() => maintenance.call("/calculate", "POST", {}), /服务暂不可用/);
  const conflict = new Api(false, async () => ({ ok: false, status: 409, json: async () => ({ detail: "配置已更新" }) }));
  await assert.rejects(() => conflict.call("/calculate", "POST", {}), (error) => error.status === 409 && error.message === "配置已更新");
});
