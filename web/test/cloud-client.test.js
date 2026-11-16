import test from "node:test";
import assert from "node:assert/strict";
import { CloudClient, OperationGate, CLOUD_MIGRATION_KEY, migrateCloudStorage } from "../js/cloud-client.js";
import { loadLedger, saveLedger, HISTORY_STORAGE_KEY, COMPARISON_STORAGE_KEY } from "../js/ledger-storage.js";
import { createDefaultState } from "../js/calculator.js";
import { createRecordSnapshot } from "../js/records.js";

class Storage {
  constructor(values = {}) { this.values = new Map(Object.entries(values)); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

test("云端请求不缓存、提升只在内存，离线不回退或报告成功", async () => {
  const calls = [], store = new Storage();
  const client = new CloudClient(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/unlock")) return Response.json({ role: "settings", elevation: "fixture-memory-token" });
    return Response.json({ csrf: "fixture-csrf", user: { id: "fixture-user" } });
  }, store);
  await client.initialize(); await client.unlock("synthetic-password");
  assert.equal(client.role, "settings");
  assert.equal(store.values.size, 0);
  assert.equal(calls[1].options.cache, "no-store");
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.equal(calls[1].options.headers["X-CSRF-Token"], "fixture-csrf");
  client.fetcher = async () => { throw new Error("offline"); };
  await assert.rejects(client.request("/me/config", "PUT", {}), /未保存/);
  client.lock(); assert.equal(client.elevation, "");
});

test("一次性清理仅清旧凭据参数模板，保留旧历史对比主题并不重复清理", () => {
  const store = new Storage({ "cottoncal.machine.users.v1": "old", "cottoncal.machine.admin-credential.v1": "old",
    "cottoncal.machine.v1": "old", "cottoncal.machine.share-template.v1": "old",
    [HISTORY_STORAGE_KEY]: "legacy", [COMPARISON_STORAGE_KEY]: "legacy-links", "cottoncal.machine.theme.v1": "gold" });
  assert.equal(migrateCloudStorage(store), true);
  assert.equal(store.getItem(HISTORY_STORAGE_KEY), "legacy");
  assert.equal(store.getItem(COMPARISON_STORAGE_KEY), "legacy-links");
  assert.equal(store.getItem("cottoncal.machine.theme.v1"), "gold");
  assert.equal(store.getItem("cottoncal.machine.users.v1"), null);
  store.setItem("cottoncal.machine.v1", "new-sentinel");
  assert.equal(migrateCloudStorage(store), true);
  assert.equal(store.getItem("cottoncal.machine.v1"), "new-sentinel");
  assert.equal(store.getItem(CLOUD_MIGRATION_KEY), "complete");
});

test("本机历史按不可复用 ID 隔离，旧历史留在遗留键", () => {
  const store = new Storage();
  const record = createRecordSnapshot(createDefaultState(), { note: "fixture" });
  saveLedger([record], [record.id], store);
  assert.equal(loadLedger(store, "user-a").records.length, 0);
  saveLedger([record], [], store, "user-a");
  assert.equal(loadLedger(store, "user-a").records.length, 1);
  assert.equal(loadLedger(store, "user-b").records.length, 0);
  assert.equal(loadLedger(store).comparisonIds.length, 1);
});

test("异步变更操作串行保护并在异常时释放", async () => {
  const gate = new OperationGate(); let release;
  const first = gate.run(() => new Promise((resolve) => { release = resolve; }));
  assert.deepEqual(await gate.run(async () => "blocked"), { entered: false });
  release(); await first;
  await assert.rejects(gate.run(async () => { throw new Error("fixture"); }));
  assert.equal(gate.userMutationPending, false);
});

test("对应旧密码错误保留提升，而失效权限清除提升，刷新不沿用提升", async () => {
  const client = new CloudClient(async () => Response.json({ detail: "密码不正确" }, { status: 401 }), new Storage());
  client.elevation = "synthetic-token"; client.role = "settings";
  await assert.rejects(client.request("/me/password/settings", "POST", {}));
  assert.equal(client.role, "settings");
  client.fetcher = async () => Response.json({ detail: "授权已失效" }, { status: 403 });
  await assert.rejects(client.request("/me/config", "PUT", {}));
  assert.equal(client.elevation, "");
  client.elevation = "synthetic-new-token"; client.role = "admin";
  client.fetcher = async () => Response.json({ csrf: "synthetic-csrf", user: null });
  await client.initialize(); assert.equal(client.role, null);
});
