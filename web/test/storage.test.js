import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, editState } from "../js/calculator.js";
import { STORAGE_KEY, deserializeState, loadState, saveState, serializeState } from "../js/storage.js";

test("存储键和序列化只使用 machine 状态", () => {
  assert.equal(STORAGE_KEY, "cottoncal.machine.v1");
  const parsed = JSON.parse(serializeState(createDefaultState()));
  assert.deepEqual(Object.keys(parsed), ["machine"]);
  assert.equal("selectedPreset" in parsed, false);
  assert.equal("hand" in parsed, false);
});

test("计算方向和修改后的机采参数可恢复", () => {
  const changed = editState(
    editState(createDefaultState(), "lintPrice", "17000"),
    "processingFee",
    "1200",
  );
  const restored = deserializeState(serializeState(changed));
  assert.equal(restored.lintPrice, "17000");
  assert.equal(restored.processingFee, "1200");
  assert.equal(restored.basis, "lint");
});

test("损坏 JSON 安全回退到机采默认值", () => {
  const restored = deserializeState("{broken");
  assert.equal(restored.lintPrice, "16987");
  assert.equal(restored.lintPercentage, "38");
});

test("缺失或损坏字段分别回退到机采默认值", () => {
  const restored = deserializeState(JSON.stringify({
    machine: { ...JSON.parse(serializeState(createDefaultState())).machine, lintPercentage: "abc", processingFee: "1.234" },
  }));
  assert.equal(restored.lintPercentage, "38");
  assert.equal(restored.processingFee, "1000");
});

test("localStorage 读写异常不影响启动", () => {
  const brokenStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(loadState(brokenStorage).lintPrice, "16987");
  assert.equal(saveState(createDefaultState(), brokenStorage), false);
});

test("持久化内容不包含解锁、失败或冷却状态", () => {
  const serialized = serializeState(createDefaultState());
  assert.doesNotMatch(serialized, /unlock|failure|cooldown/i);
});
