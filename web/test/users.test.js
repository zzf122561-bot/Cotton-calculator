import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  AUTHORIZED_USERS_INITIALIZED_KEY,
  AUTHORIZED_USERS_STORAGE_KEY,
  INITIAL_AUTHORIZED_USER,
  UserMutationGate,
  authenticateAuthorizedUser,
  createAuthorizedUser,
  deserializeAuthorizedUsers,
  findPasswordConflict,
  initializeAuthorizedUsers,
  resetAuthorizedUserPassword,
  saveAuthorizedUsers,
} from "../js/users.js";

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
  snapshot() { return Object.fromEntries(this.values); }
}

function deterministicCrypto(byte = 7) {
  return {
    subtle: webcrypto.subtle,
    getRandomValues(target) { target.fill(byte); return target; },
  };
}

test("FYX 只在首次初始化 seed，一次删空后重开仍为空", () => {
  const storage = new MemoryStorage();
  const first = initializeAuthorizedUsers(storage);
  assert.equal(first.length, 1);
  assert.equal(first[0].name, "FYX");
  assert.equal(first[0].id, INITIAL_AUTHORIZED_USER.id);
  assert.ok(storage.getItem(AUTHORIZED_USERS_INITIALIZED_KEY));
  assert.equal(saveAuthorizedUsers([], storage), true);
  const reopened = new MemoryStorage(storage.snapshot());
  assert.deepEqual(initializeAuthorizedUsers(reopened), []);
});

test("逐用户保存独立 KDF 参数并按各自参数验证", async () => {
  const cryptoProvider = deterministicCrypto(11);
  const user = await createAuthorizedUser("测试用户", "fixture-one", {
    id: "user-1",
    cryptoProvider,
    iterations: 3,
    keyBits: 128,
  });
  assert.equal(user.algorithm, "PBKDF2-HMAC-SHA256");
  assert.equal(user.credentialVersion, 1);
  assert.equal(user.iterations, 3);
  assert.equal(user.keyBits, 128);
  assert.equal((await authenticateAuthorizedUser("fixture-one", [user], cryptoProvider)).id, "user-1");
  assert.equal(await authenticateAuthorizedUser("fixture-two", [user], cryptoProvider), null);
  assert.equal(await authenticateAuthorizedUser("fixture-one", [{ ...user, enabled: false }], cryptoProvider), null);
});

test("重置密码生成新盐并让旧校验失效", async () => {
  const firstCrypto = deterministicCrypto(3);
  const nextCrypto = deterministicCrypto(9);
  const user = await createAuthorizedUser("测试用户", "fixture-one", { id: "user-1", cryptoProvider: firstCrypto, iterations: 3, keyBits: 128 });
  const reset = await resetAuthorizedUserPassword(user, "fixture-two", { cryptoProvider: nextCrypto, iterations: 4, keyBits: 128 });
  assert.notEqual(reset.saltBase64, user.saltBase64);
  assert.equal(reset.iterations, 4);
  assert.equal(await authenticateAuthorizedUser("fixture-one", [reset], nextCrypto), null);
  assert.equal((await authenticateAuthorizedUser("fixture-two", [reset], nextCrypto)).id, "user-1");
});

test("新增或重置密码拒绝管理员与其他普通用户冲突，重置排除本人", async () => {
  const cryptoProvider = deterministicCrypto(13);
  const first = await createAuthorizedUser("甲", "fixture-user-one", {
    id: "user-1", cryptoProvider, iterations: 3, keyBits: 128,
  });
  const second = await createAuthorizedUser("乙", "fixture-user-two", {
    id: "user-2", cryptoProvider: deterministicCrypto(17), iterations: 3, keyBits: 128,
  });
  const verifyAdmin = async (candidate) => candidate === "fixture-admin";
  assert.deepEqual(
    await findPasswordConflict("fixture-admin", [first, second], { verifyAdmin, cryptoProvider }),
    { type: "admin" },
  );
  assert.deepEqual(
    await findPasswordConflict("fixture-user-one", [first, second], { verifyAdmin, cryptoProvider }),
    { type: "user", userId: "user-1", name: "甲" },
  );
  assert.equal(
    await findPasswordConflict("fixture-user-one", [first, second], { excludeUserId: "user-1", verifyAdmin, cryptoProvider }),
    null,
  );
  assert.deepEqual(
    await findPasswordConflict("fixture-user-two", [first, second], { excludeUserId: "user-1", verifyAdmin, cryptoProvider }),
    { type: "user", userId: "user-2", name: "乙" },
  );
});

test("用户存储损坏时严格回退，不从损坏记录推断凭据", () => {
  assert.deepEqual(deserializeAuthorizedUsers("{broken"), []);
  const malformed = JSON.stringify({ schemaVersion: 1, users: [{ ...INITIAL_AUTHORIZED_USER, verifierBase64: "not-base64" }] });
  assert.deepEqual(deserializeAuthorizedUsers(malformed), []);
  const storage = new MemoryStorage({
    [AUTHORIZED_USERS_STORAGE_KEY]: malformed,
    [AUTHORIZED_USERS_INITIALIZED_KEY]: JSON.stringify({ schemaVersion: 1, initialized: true }),
  });
  assert.deepEqual(initializeAuthorizedUsers(storage), []);
});

test("localStorage 不可用时回退为当前会话默认用户", () => {
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(initializeAuthorizedUsers(broken)[0].name, "FYX");
  assert.equal(saveAuthorizedUsers([], broken), false);
});

test("快速双提交和并发新增重置只允许一个用户变更临界区进入，释放后可继续", async () => {
  const gate = new UserMutationGate();
  const busyStates = [];
  let releaseFirst;
  const firstBarrier = new Promise((resolve) => { releaseFirst = resolve; });
  const entered = [];

  const add = gate.run(async () => {
    entered.push("add");
    await firstBarrier;
    return "added";
  }, (pending) => busyStates.push(pending));
  const duplicateAdd = await gate.run(async () => { entered.push("duplicate-add"); });
  const concurrentReset = await gate.run(async () => { entered.push("reset-during-add"); });
  assert.deepEqual(duplicateAdd, { entered: false });
  assert.deepEqual(concurrentReset, { entered: false });
  assert.equal(gate.userMutationPending, true);
  assert.deepEqual(entered, ["add"]);

  releaseFirst();
  assert.deepEqual(await add, { entered: true, value: "added" });
  assert.equal(gate.userMutationPending, false);
  assert.deepEqual(busyStates, [true, false]);

  const resetAfterRelease = await gate.run(async () => {
    entered.push("reset-after-release");
    return "reset";
  });
  assert.deepEqual(resetAfterRelease, { entered: true, value: "reset" });
  assert.deepEqual(entered, ["add", "reset-after-release"]);
});
