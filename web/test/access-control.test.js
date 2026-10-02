import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  ADMIN_VERIFIER_CONFIG,
  AccessGate,
  TenTapTrigger,
  constantTimeEqual,
  derivePbkdf2Sha256,
} from "../js/access-control.js";

test("9 击不触发，5 秒内第 10 击触发", () => {
  let now = 0;
  const trigger = new TenTapTrigger(() => now);
  for (let index = 0; index < 9; index += 1) {
    assert.equal(trigger.registerTap(), false);
    now += 400;
  }
  assert.equal(trigger.registerTap(), true);
});

test("超过 5 秒后十击窗口清零", () => {
  let now = 0;
  const trigger = new TenTapTrigger(() => now);
  for (let index = 0; index < 9; index += 1) {
    trigger.registerTap();
    now += 400;
  }
  now = 5_001;
  assert.equal(trigger.registerTap(), false);
  for (let index = 0; index < 8; index += 1) {
    now += 400;
    assert.equal(trigger.registerTap(), false);
  }
  now += 400;
  assert.equal(trigger.registerTap(), true);
});

test("依赖注入校验器覆盖正确和错误结果", async () => {
  let accepted = false;
  const gate = new AccessGate({ verify: async () => accepted, now: () => 0 });
  assert.deepEqual(await gate.submit("x"), { status: "incorrect", attemptsRemaining: 4 });
  assert.equal(gate.unlocked, false);
  accepted = true;
  assert.deepEqual(await gate.submit("x"), { status: "unlocked", principal: { type: "user", id: "injected" } });
  assert.equal(gate.unlocked, true);
});

test("普通用户解锁后可再次十击进入管理员，管理员退出后重新锁定", async () => {
  let now = 0;
  let nextPrincipal = { type: "user", id: "user-1" };
  const gate = new AccessGate({ authenticate: async () => nextPrincipal, now: () => now });
  assert.equal((await gate.submit("fixture-user")).principal.type, "user");
  for (let index = 0; index < 9; index += 1) {
    assert.equal(gate.registerTap(), false);
    now += 200;
  }
  assert.equal(gate.registerTap(), true);
  nextPrincipal = { type: "admin" };
  assert.equal((await gate.submit("fixture-admin")).principal.type, "admin");
  assert.equal(gate.registerTap(), false);
  gate.lock();
  assert.equal(gate.unlocked, false);
});

test("连续错误 5 次后冷却 30 秒", async () => {
  let now = 0;
  let calls = 0;
  const gate = new AccessGate({ verify: async () => { calls += 1; return false; }, now: () => now });
  for (let index = 0; index < 4; index += 1) assert.equal((await gate.submit("x")).status, "incorrect");
  assert.deepEqual(await gate.submit("x"), { status: "cooldown", secondsRemaining: 30 });
  assert.deepEqual(await gate.submit("x"), { status: "cooldown", secondsRemaining: 30 });
  assert.equal(calls, 5);
  now = 30_000;
  assert.deepEqual(await gate.submit("x"), { status: "incorrect", attemptsRemaining: 4 });
});

test("新运行实例重新锁定", async () => {
  const verify = async () => true;
  const first = new AccessGate({ verify, now: () => 0 });
  await first.submit("x");
  assert.equal(first.unlocked, true);
  assert.equal(new AccessGate({ verify, now: () => 0 }).unlocked, false);
});

test("PBKDF2-SHA256 测试向量和恒定时间比较", async () => {
  const passwordBytes = new Uint8Array([112, 97, 115, 115, 119, 111, 114, 100]);
  const saltBytes = new Uint8Array([115, 97, 108, 116]);
  const derived = await derivePbkdf2Sha256(passwordBytes, saltBytes, 1, webcrypto);
  assert.equal(Buffer.from(derived).toString("hex"), "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
  assert.equal(constantTimeEqual(derived, derived.slice()), true);
  assert.equal(constantTimeEqual(derived, new Uint8Array(derived.length)), false);
});

test("管理员不可逆配置固定为版本 1、210000 次和 256 位", () => {
  assert.equal(ADMIN_VERIFIER_CONFIG.algorithm, "PBKDF2-HMAC-SHA256");
  assert.equal(ADMIN_VERIFIER_CONFIG.credentialVersion, 1);
  assert.equal(ADMIN_VERIFIER_CONFIG.iterations, 210_000);
  assert.equal(ADMIN_VERIFIER_CONFIG.keyBits, 256);
  assert.equal(ADMIN_VERIFIER_CONFIG.saltBase64, "MVhVUJ0OO5rsGgdhO18Cog==");
  assert.equal(ADMIN_VERIFIER_CONFIG.verifierBase64, "XSoEK1e33FqI1213ciSRAdz55yYZBbSztuZMaj/1f4A=");
});
