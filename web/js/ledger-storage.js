import {
  deserializeComparison,
  deserializeRecords,
  serializeComparison,
  serializeRecords,
} from "./records.js";

export const HISTORY_STORAGE_KEY = "cottoncal.machine.history.v1";
export const COMPARISON_STORAGE_KEY = "cottoncal.machine.comparison.v1";

function keys(userId) {
  if (userId === null) return [HISTORY_STORAGE_KEY, COMPARISON_STORAGE_KEY];
  if (typeof userId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(userId)) throw new TypeError("Invalid user ID");
  return [`cottoncal.machine.user.${userId}.history.v1`, `cottoncal.machine.user.${userId}.comparison.v1`];
}

export function loadLedger(storage = globalThis.localStorage, userId = null) {
  try {
    const [historyKey, comparisonKey] = keys(userId);
    const records = deserializeRecords(storage.getItem(historyKey));
    const comparisonIds = deserializeComparison(storage.getItem(comparisonKey), records);
    return { records, comparisonIds };
  } catch {
    return { records: [], comparisonIds: [] };
  }
}

export function saveLedger(records, comparisonIds, storage = globalThis.localStorage, userId = null) {
  const [historyKey, comparisonKey] = keys(userId);
  let previousRecords;
  let previousComparison;
  try {
    previousRecords = storage.getItem(historyKey);
    previousComparison = storage.getItem(comparisonKey);
    storage.setItem(historyKey, serializeRecords(records));
    storage.setItem(comparisonKey, serializeComparison(comparisonIds));
    return true;
  } catch {
    try {
      if (previousRecords === null || previousRecords === undefined) storage.removeItem(historyKey);
      else storage.setItem(historyKey, previousRecords);
      if (previousComparison === null || previousComparison === undefined) storage.removeItem(comparisonKey);
      else storage.setItem(comparisonKey, previousComparison);
    } catch {
      // The in-memory ledger remains usable when storage and rollback are both unavailable.
    }
    return false;
  }
}
