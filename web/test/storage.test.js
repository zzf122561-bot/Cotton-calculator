import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, editState } from "../js/calculator.js";
import { STORAGE_KEY, deserializeState, loadState, saveState, serializeState } from "../js/storage.js";

test("存储键固定且结构包含 selectedPreset、hand、machine", () => {
  assert.equal(STORAGE_KEY, "cottoncal.pwa.v1");
  const parsed = JSON.parse(serializeState({ selectedPreset: "hand", hand: createDefaultState("hand"), machine: createDefaultState("machine") }));
  assert.deepEqual(Object.keys(parsed).sort(), ["hand", "machine", "selectedPreset"]);
});

test("两套状态、方向与明细展开状态独立恢复", () => {
  const hand = { ...editState(createDefaultState("hand"), "lintPrice", "15000"), detailsExpanded: true };
  const machine = editState(createDefaultState("machine"), "seedCottonPrice", "7.8");
  const restored = deserializeState(serializeState({ selectedPreset: "machine", hand, machine }));
  assert.equal(restored.selectedPreset, "machine");
  assert.equal(restored.hand.lintPrice, "15000");
  assert.equal(restored.hand.basis, "lint");
  assert.equal(restored.hand.detailsExpanded, true);
  assert.equal(restored.machine.seedCottonPrice, "7.8");
  assert.equal(restored.machine.basis, "seed");
});

test("损坏 JSON 安全回退到两套默认值", () => {
  const restored = deserializeState("{broken");
  assert.equal(restored.selectedPreset, "hand");
  assert.equal(restored.hand.lintPrice, "14249");
  assert.equal(restored.machine.lintPrice, "16987");
});

test("缺失预设与字段损坏分别回退到对应默认值", () => {
  const hand = JSON.parse(serializeState({
    selectedPreset: "hand",
    hand: createDefaultState("hand"),
    machine: createDefaultState("machine"),
  })).hand;
  const restored = deserializeState(JSON.stringify({
    selectedPreset: "machine",
    hand: { ...hand, lintPercentage: "abc", processingFee: "1.234" },
  }));
  assert.equal(restored.hand.lintPercentage, "40.6");
  assert.equal(restored.hand.processingFee, "800");
  assert.equal(restored.machine.lintPrice, "16987");
});

test("localStorage 读写异常时不影响应用启动", () => {
  const brokenStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(loadState(brokenStorage).hand.lintPrice, "14249");
  assert.equal(saveState({ selectedPreset: "hand", hand: createDefaultState("hand"), machine: createDefaultState("machine") }, brokenStorage), false);
});

test("恢复默认值可只替换当前棉种", () => {
  const editedMachine = editState(createDefaultState("machine"), "seedCottonPrice", "9");
  const state = { selectedPreset: "hand", hand: editState(createDefaultState("hand"), "seedCottonPrice", "8"), machine: editedMachine };
  const reset = { ...state, hand: createDefaultState("hand") };
  assert.equal(reset.hand.seedCottonPrice, "6.73832884794535");
  assert.equal(reset.machine.seedCottonPrice, "9");
});
