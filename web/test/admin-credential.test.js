import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { ADMIN_VERIFIER_CONFIG, verifyPasswordCredential } from "../js/access-control.js";
import {
  ADMIN_CREDENTIAL_STORAGE_KEY,
  changeAdminPassword,
  loadAdminCredential,
  serializeAdminCredential,
} from "../js/admin-credential.js";
import { createAuthorizedUser, createPasswordCredential, findPasswordConflict } from "../js/users.js";

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
  snapshot() { return Object.fromEntries(this.values); }
}

function rotatingCrypto() {
  let saltByte = 0;
  return {
    subtle: webcrypto.subtle,
    getRandomValues(target) { target.fill(++saltByte); return target; },
  };
}

async function seededAdmin() {
  const cryptoProvider = rotatingCrypto();
  const storage = new MemoryStorage();
  const original = await createPasswordCredential("fixture-admin-old", { cryptoProvider });
  storage.setItem(ADMIN_CREDENTIAL_STORAGE_KEY, serializeAdminCredential(original));
  return { cryptoProvider, storage, original };
}

test("无本地改密时沿用内置材料，损坏或不可读时管理员校验拒绝回退", () => {
  assert.equal(loadAdminCredential(new MemoryStorage()).credential, ADMIN_VERIFIER_CONFIG);
  const malformed = new MemoryStorage({ [ADMIN_CREDENTIAL_STORAGE_KEY]: "{broken" });
  assert.equal(loadAdminCredential(malformed).status, "invalid");
  assert.equal(loadAdminCredential(malformed).credential, null);
  const changedParameters = new MemoryStorage({
    [ADMIN_CREDENTIAL_STORAGE_KEY]: serializeAdminCredential(ADMIN_VERIFIER_CONFIG).replace('"iterations":210000', '"iterations":1'),
  });
  assert.equal(loadAdminCredential(changedParameters).status, "invalid");
  assert.equal(loadAdminCredential({ getItem() { throw new Error("denied"); } }).status, "unavailable");
});

test("正确当前密码生成独立随机盐，仅保存 verifier，重开后旧密码失效、新密码生效", async () => {
  const { cryptoProvider, storage, original } = await seededAdmin();
  const result = await changeAdminPassword({
    currentPassword: "fixture-admin-old",
    newPassword: "fixture-admin-new",
    confirmation: "fixture-admin-new",
    users: [], storage, cryptoProvider,
  });
  assert.equal(result.status, "changed");
  assert.notEqual(result.credential.saltBase64, original.saltBase64);
  assert.equal(result.credential.iterations, ADMIN_VERIFIER_CONFIG.iterations);
  assert.equal(result.credential.keyBits, ADMIN_VERIFIER_CONFIG.keyBits);
  const saved = storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY);
  assert.equal(saved.includes("fixture-admin-old"), false);
  assert.equal(saved.includes("fixture-admin-new"), false);
  const reopened = loadAdminCredential(new MemoryStorage(storage.snapshot()));
  assert.equal(reopened.status, "stored");
  assert.equal(await verifyPasswordCredential("fixture-admin-old", reopened.credential, cryptoProvider), false);
  assert.equal(await verifyPasswordCredential("fixture-admin-new", reopened.credential, cryptoProvider), true);
  assert.equal((await findPasswordConflict("fixture-admin-new", [], {
    verifyAdmin: (candidate) => verifyPasswordCredential(candidate, reopened.credential, cryptoProvider),
  })).type, "admin");
});

test("错误当前密码、确认不符、长度不足、复用原密码及普通用户冲突均不写入", async () => {
  const { cryptoProvider, storage } = await seededAdmin();
  const ordinary = await createAuthorizedUser("停用用户", "fixture-user-password", {
    id: "fixture-user", cryptoProvider, iterations: 3, keyBits: 128,
  });
  ordinary.enabled = false;
  const before = storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY);
  const base = {
    currentPassword: "fixture-admin-old",
    newPassword: "fixture-admin-new",
    confirmation: "fixture-admin-new",
    users: [ordinary], storage, cryptoProvider,
  };
  assert.equal((await changeAdminPassword({ ...base, currentPassword: "fixture-wrong-old" })).status, "incorrect-current");
  assert.equal((await changeAdminPassword({ ...base, confirmation: "fixture-other-new" })).status, "mismatch");
  assert.equal((await changeAdminPassword({ ...base, newPassword: "short", confirmation: "short" })).status, "invalid-length");
  assert.equal((await changeAdminPassword({ ...base, newPassword: "fixture-admin-old", confirmation: "fixture-admin-old" })).status, "same-password");
  assert.equal((await changeAdminPassword({ ...base, newPassword: "fixture-user-password", confirmation: "fixture-user-password" })).status, "user-conflict");
  assert.equal(storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY), before);
});

test("浏览器写入失败或未落盘不报告成功，也不返回可激活的新材料", async () => {
  const { cryptoProvider, storage } = await seededAdmin();
  const before = storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY);
  const base = {
    currentPassword: "fixture-admin-old",
    newPassword: "fixture-admin-new",
    confirmation: "fixture-admin-new",
    users: [], cryptoProvider,
  };
  const throwsOnWrite = {
    getItem: storage.getItem.bind(storage),
    setItem() { throw new Error("quota"); },
  };
  assert.deepEqual(await changeAdminPassword({ ...base, storage: throwsOnWrite }), { status: "storage-failure" });
  const noOpWrite = {
    getItem: storage.getItem.bind(storage),
    setItem() {},
  };
  assert.deepEqual(await changeAdminPassword({ ...base, storage: noOpWrite }), { status: "storage-failure" });
  assert.equal(storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY), before);
  assert.equal(await verifyPasswordCredential("fixture-admin-old", loadAdminCredential(storage).credential, cryptoProvider), true);
  assert.equal(await verifyPasswordCredential("fixture-admin-new", loadAdminCredential(storage).credential, cryptoProvider), false);
});

test("过期页面不能覆盖其他页面已保存的管理员密码", async () => {
  const { cryptoProvider, storage } = await seededAdmin();
  const expectedSerialized = storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY);
  const external = await createPasswordCredential("fixture-other-admin", { cryptoProvider });
  storage.setItem(ADMIN_CREDENTIAL_STORAGE_KEY, serializeAdminCredential(external));
  const result = await changeAdminPassword({
    currentPassword: "fixture-admin-old",
    newPassword: "fixture-admin-new",
    confirmation: "fixture-admin-new",
    users: [], storage, cryptoProvider, expectedSerialized,
  });
  assert.equal(result.status, "changed-concurrently");
  assert.equal(await verifyPasswordCredential("fixture-other-admin", loadAdminCredential(storage).credential, cryptoProvider), true);
});
