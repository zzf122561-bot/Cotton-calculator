import {
  deserializeComparison,
  deserializeRecords,
  serializeComparison,
  serializeRecords,
} from "./records.js";

export const HISTORY_STORAGE_KEY = "cottoncal.machine.history.v1";
export const COMPARISON_STORAGE_KEY = "cottoncal.machine.comparison.v1";

export function loadLedger(storage = globalThis.localStorage) {
  try {
    const records = deserializeRecords(storage.getItem(HISTORY_STORAGE_KEY));
    const comparisonIds = deserializeComparison(storage.getItem(COMPARISON_STORAGE_KEY), records);
    return { records, comparisonIds };
  } catch {
    return { records: [], comparisonIds: [] };
  }
}

export function saveLedger(records, comparisonIds, storage = globalThis.localStorage) {
  let previousRecords;
  let previousComparison;
  try {
    previousRecords = storage.getItem(HISTORY_STORAGE_KEY);
    previousComparison = storage.getItem(COMPARISON_STORAGE_KEY);
    storage.setItem(HISTORY_STORAGE_KEY, serializeRecords(records));
    storage.setItem(COMPARISON_STORAGE_KEY, serializeComparison(comparisonIds));
    return true;
  } catch {
    try {
      if (previousRecords === null || previousRecords === undefined) storage.removeItem(HISTORY_STORAGE_KEY);
      else storage.setItem(HISTORY_STORAGE_KEY, previousRecords);
      if (previousComparison === null || previousComparison === undefined) storage.removeItem(COMPARISON_STORAGE_KEY);
      else storage.setItem(COMPARISON_STORAGE_KEY, previousComparison);
    } catch {
      // The in-memory ledger remains usable when storage and rollback are both unavailable.
    }
    return false;
  }
}
