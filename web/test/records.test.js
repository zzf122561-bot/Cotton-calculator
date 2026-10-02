import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, editState } from "../js/calculator.js";
import { COMPARISON_STORAGE_KEY, HISTORY_STORAGE_KEY, loadLedger, saveLedger } from "../js/ledger-storage.js";
import {
  addExistingRecordToComparison,
  buildSeedPriceComparison,
  createRecordSnapshot,
  deleteRecord,
  deserializeComparison,
  deserializeRecords,
  saveAndAddCurrentToComparison,
  searchRecords,
  serializeComparison,
  serializeRecords,
} from "../js/records.js";

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

function snapshot(seedPrice, id, note = "") {
  const state = editState(createDefaultState(), "seedCottonPrice", seedPrice);
  return createRecordSnapshot(state, { id, note, savedAt: `2026-09-${String(Number(id.replace(/\D/g, "") || 1)).padStart(2, "0")}T08:30:00` });
}

test("历史快照保存完整输入与精确结果，后续参数变化不改旧记录", () => {
  const before = createDefaultState();
  const saved = createRecordSnapshot(before, { id: "record-1", note: "北疆方案", savedAt: "2026-09-21T08:30:00" });
  const after = editState(before, "processingFee", "1200");
  assert.equal(saved.inputs.processingFee, "1000");
  assert.equal(saved.note, "北疆方案");
  assert.equal(saved.basis, "seed");
  assert.notEqual(after.lintPrice, saved.displayResults.lintPrice);
  assert.deepEqual(saved.exactResults.seedCottonPrice, { numerator: "73", denominator: "10" });
});

test("当前结果加入对比先预检内容重复，失败不残留新历史", () => {
  const first = snapshot("7.3", "record-1", "第一条");
  const added = saveAndAddCurrentToComparison([], [], first);
  assert.equal(added.ok, true);
  const sameCalculation = snapshot("7.30", "record-2", "备注不同");
  const duplicate = saveAndAddCurrentToComparison(added.records, added.comparisonIds, sameCalculation);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.reason, "duplicate");
  assert.deepEqual(duplicate.records.map((record) => record.id), ["record-1"]);
});

test("当前结果加入对比按备注规则优先复用最新相同历史", () => {
  const older = snapshot("7.3", "record-1", "旧备注");
  const latest = snapshot("7.30", "record-2", "最新备注");
  const emptyNote = snapshot("7.300", "record-3", "");
  const reusedLatest = saveAndAddCurrentToComparison([latest, older], [], emptyNote);
  assert.equal(reusedLatest.ok, true);
  assert.equal(reusedLatest.reused, true);
  assert.deepEqual(reusedLatest.records.map((record) => record.id), ["record-2", "record-1"]);
  assert.deepEqual(reusedLatest.comparisonIds, ["record-2"]);

  const matchingNote = snapshot("7.3", "record-4", "旧备注");
  const reusedSameNote = saveAndAddCurrentToComparison([latest, older], [], matchingNote);
  assert.equal(reusedSameNote.reused, true);
  assert.deepEqual(reusedSameNote.comparisonIds, ["record-1"]);

  const newNote = snapshot("7.3", "record-5", "新注释");
  const savedNew = saveAndAddCurrentToComparison([latest, older], [], newNote);
  assert.equal(savedNew.reused, false);
  assert.deepEqual(savedNew.records.map((record) => record.id), ["record-5", "record-2", "record-1"]);
});

test("对比轨道使用精确籽棉单价并以两位 HALF_UP 标记最低最高", () => {
  const low = snapshot("7.101", "record-1");
  const middle = snapshot("7.205", "record-2");
  const high = snapshot("7.309", "record-3");
  const comparison = buildSeedPriceComparison([low, middle, high]);
  assert.deepEqual(comparison.map((entry) => entry.displayPrice), ["7.10", "7.21", "7.31"]);
  assert.deepEqual(comparison.map((entry) => entry.marker), ["最低", "较最低 +0.10 元/公斤", "最高"]);
  assert.deepEqual(comparison.map((entry) => entry.position), [0, 50, 100]);
  const same = buildSeedPriceComparison([snapshot("7.3", "record-4"), snapshot("7.30", "record-5")]);
  assert.deepEqual(same.map((entry) => entry.marker), ["相同", "相同"]);
  assert.deepEqual(same.map((entry) => entry.position), [50, 50]);
});

test("对比最多四条且满额时不新增历史", () => {
  const existing = [snapshot("7.1", "record-1"), snapshot("7.2", "record-2"), snapshot("7.3", "record-3"), snapshot("7.4", "record-4")];
  const comparisonIds = existing.map((record) => record.id);
  const next = snapshot("7.5", "record-5");
  const outcome = saveAndAddCurrentToComparison(existing, comparisonIds, next);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "full");
  assert.equal(outcome.records.length, 4);
});

test("历史可按备注、日期和两侧价格检索，删除同步移除对比链接", () => {
  const first = snapshot("7.3", "record-1", "北疆到厂");
  const second = snapshot("7.5", "record-2", "南疆仓库");
  assert.deepEqual(searchRecords([first, second], "北疆").map((record) => record.id), ["record-1"]);
  assert.deepEqual(searchRecords([first, second], "2026-09-02").map((record) => record.id), ["record-2"]);
  assert.deepEqual(searchRecords([first, second], first.displayResults.lintPrice).map((record) => record.id), ["record-1"]);
  assert.deepEqual(searchRecords([first, second], second.displayResults.seedCottonPrice).map((record) => record.id), ["record-2"]);
  const deleted = deleteRecord([first, second], [first.id, second.id], first.id);
  assert.deepEqual(deleted.records.map((record) => record.id), [second.id]);
  assert.deepEqual(deleted.comparisonIds, [second.id]);
});

test("历史与对比严格反序列化，损坏内容安全回退", () => {
  const records = [snapshot("7.3", "record-1")];
  assert.equal(deserializeRecords(serializeRecords(records)).length, 1);
  assert.deepEqual(deserializeRecords("{broken"), []);
  const corrupted = JSON.parse(serializeRecords(records));
  corrupted.records[0].displayResults.seedCottonPrice = "999";
  assert.deepEqual(deserializeRecords(JSON.stringify(corrupted)), []);
  assert.deepEqual(deserializeComparison(serializeComparison(["record-1", "missing"]), records), ["record-1"]);
});

test("历史加入对比按规范化内容去重而不是记录 ID", () => {
  const first = snapshot("7.3", "record-1", "A");
  const duplicate = snapshot("7.30", "record-2", "B");
  const outcome = addExistingRecordToComparison([first, duplicate], [first.id], duplicate.id);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "duplicate");
});

test("账本存储使用独立 schema 键，异常时回退且不影响计算存储键", () => {
  const storage = new MemoryStorage();
  const record = snapshot("7.3", "record-1");
  assert.equal(saveLedger([record], [record.id], storage), true);
  assert.ok(storage.getItem(HISTORY_STORAGE_KEY));
  assert.ok(storage.getItem(COMPARISON_STORAGE_KEY));
  assert.equal(loadLedger(storage).records.length, 1);
  const broken = { getItem() { throw new Error("denied"); } };
  assert.deepEqual(loadLedger(broken), { records: [], comparisonIds: [] });
});
