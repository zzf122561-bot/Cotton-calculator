import test from "node:test";
import assert from "node:assert/strict";
import { Decimal, formatFixed, formatTrimmed } from "../js/decimal.js";
import { calculate, createDefaultState, editState, isAllowedInput } from "../js/calculator.js";

function decimalInputs(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Decimal.parse(value)]));
}

function machineInputs() {
  return decimalInputs({
    seedCottonPrice: "7.3", lintPrice: "0", lintPercentage: "38", lossPercentage: "13",
    cottonseedPrice: "2.5", processingFee: "1000", laborFee: "0", warehouseFee: "0", financeFee: "0", subsidy: "0",
  });
}

test("机采棉样例输出 16987 元/吨", () => {
  const outcome = calculate(machineInputs(), "seed");
  assert.equal(outcome.ok, true);
  assert.equal(formatTrimmed(outcome.result.cottonseedYield, 4), "0.49");
  assert.equal(formatTrimmed(outcome.result.cottonseedDeductionPerKg, 4), "1.225");
  assert.equal(formatFixed(outcome.result.lintPrice, 0), "16987");
});

test("正算精确结果反算可恢复原籽棉价", () => {
  const forward = calculate(machineInputs(), "seed");
  const reverse = calculate({ ...machineInputs(), lintPrice: forward.result.lintPrice }, "lint");
  assert.equal(reverse.ok, true);
  assert.equal(reverse.result.seedCottonPrice.compare(machineInputs().seedCottonPrice), 0);
});

test("编辑皮棉价切换依据并反算籽棉价", () => {
  const changed = editState(createDefaultState(), "lintPrice", "17000");
  assert.equal(changed.basis, "lint");
  assert.equal(changed.lintPrice, "17000");
  assert.equal(changed.seedCottonPrice, "7.31");
});

test("相同价格不改变计算方向", () => {
  const initial = createDefaultState();
  const unchanged = editState(initial, "lintPrice", initial.lintPrice);
  assert.equal(unchanged, initial);
  assert.equal(unchanged.basis, "seed");
});

test("解锁后修改参数保留最后价格依据并重新计算", () => {
  const lintBased = editState(createDefaultState(), "lintPrice", "17000");
  const changed = editState(lintBased, "processingFee", "1200");
  assert.equal(changed.basis, "lint");
  assert.equal(changed.lintPrice, "17000");
  assert.notEqual(changed.seedCottonPrice, lintBased.seedCottonPrice);
});

test("费用相加且补贴冲减", () => {
  const input = machineInputs();
  Object.assign(input, decimalInputs({ processingFee: "800", laborFee: "20", warehouseFee: "30", financeFee: "40", subsidy: "100" }));
  const outcome = calculate(input, "seed");
  assert.equal(formatTrimmed(outcome.result.netFeesPerTon, 2), "790");
  assert.equal(outcome.result.lintPrice.compare(outcome.result.rawLintCostPerTon.add(Decimal.parse("790"))), 0);
});

test("显示精度采用 HALF_UP", () => {
  assert.equal(formatFixed(Decimal.parse("6.735"), 2), "6.74");
  assert.equal(formatFixed(Decimal.parse("14248.5"), 0), "14249");
  assert.equal(formatFixed(Decimal.parse("-1.235"), 2), "-1.24");
});

test("字段级小数位限制与整数限制", () => {
  assert.equal(isAllowedInput("6.123456", 6), true);
  assert.equal(isAllowedInput("6.1234567", 6), false);
  assert.equal(isAllowedInput("15000", 0), true);
  assert.equal(isAllowedInput("15000.1", 0), false);
});

test("空白有效输入产生定向错误", () => {
  const changed = editState(createDefaultState(), "seedCottonPrice", "");
  assert.equal(changed.result, null);
  assert.deepEqual(changed.errors[0], { field: "seedCottonPrice", message: "请输入有效数字" });
});

test("衣分率为 0 被拒绝", () => {
  const outcome = calculate({ ...machineInputs(), lintPercentage: Decimal.parse("0") }, "seed");
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((item) => item.field === "lintPercentage"));
});

test("衣分率与损耗率之和超过 100 被拒绝", () => {
  const outcome = calculate({ ...machineInputs(), lintPercentage: Decimal.parse("60"), lossPercentage: Decimal.parse("41") }, "seed");
  assert.equal(outcome.ok, false);
  assert.ok(outcome.errors.some((item) => item.field === "lossPercentage"));
});

test("目标皮棉价过低导致负籽棉价时被拒绝", () => {
  const outcome = calculate({ ...machineInputs(), lintPrice: Decimal.parse("0"), cottonseedPrice: Decimal.parse("0"), subsidy: Decimal.parse("0") }, "lint");
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.errors[0], { field: "lintPrice", message: "目标皮棉价过低，反算出的籽棉价小于0" });
});
