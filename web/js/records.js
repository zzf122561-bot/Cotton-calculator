import { FIELDS, isAllowedInput } from "./calculator.js";
import { Decimal, formatFixed, roundHalfUp } from "./decimal.js";

export const RECORDS_SCHEMA_VERSION = 1;
export const COMPARISON_SCHEMA_VERSION = 1;
export const HISTORY_PAGE_SIZE = 30;
export const MAX_COMPARISON_RECORDS = 4;

const exactPriceFields = ["seedCottonPrice", "lintPrice"];

function ownKeysEqual(value, expected) {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function decimalToStored(value) {
  return { numerator: value.numerator.toString(), denominator: value.denominator.toString() };
}

export function decimalFromStored(value) {
  if (!isPlainObject(value) || !ownKeysEqual(value, ["denominator", "numerator"])) return null;
  if (!/^-?\d+$/.test(value.numerator) || !/^\d+$/.test(value.denominator)) return null;
  try {
    const denominator = BigInt(value.denominator);
    if (denominator === 0n) return null;
    return new Decimal(BigInt(value.numerator), denominator);
  } catch {
    return null;
  }
}

function normalizeInput(value) {
  try {
    const decimal = Decimal.parse(value);
    return `${decimal.numerator}/${decimal.denominator}`;
  } catch {
    return value;
  }
}

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `record-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createRecordSnapshot(state, { note = "", savedAt = new Date(), id = createId() } = {}) {
  if (!state?.result || state.errors?.length) throw new TypeError("A valid calculation result is required");
  const date = savedAt instanceof Date ? savedAt : new Date(savedAt);
  if (Number.isNaN(date.getTime())) throw new TypeError("savedAt must be a valid date");
  const inputs = Object.fromEntries(Object.keys(FIELDS).map((field) => [field, state[field]]));
  const exactResults = Object.fromEntries(
    exactPriceFields.map((field) => [field, decimalToStored(state.result[field])]),
  );
  const displayResults = {
    seedCottonPrice: formatFixed(state.result.seedCottonPrice, 2),
    lintPrice: formatFixed(state.result.lintPrice, 0),
  };
  return {
    schemaVersion: RECORDS_SCHEMA_VERSION,
    id,
    savedAt: date.toISOString(),
    note: String(note).trim().slice(0, 200),
    basis: state.basis,
    inputs,
    exactResults,
    displayResults,
  };
}

export function sanitizeRecordSnapshot(candidate) {
  if (!isPlainObject(candidate) || !ownKeysEqual(candidate, [
    "basis", "displayResults", "exactResults", "id", "inputs", "note", "savedAt", "schemaVersion",
  ])) return null;
  if (candidate.schemaVersion !== RECORDS_SCHEMA_VERSION) return null;
  if (typeof candidate.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(candidate.id)) return null;
  if (typeof candidate.note !== "string" || candidate.note.length > 200) return null;
  if (candidate.basis !== "seed" && candidate.basis !== "lint") return null;
  if (typeof candidate.savedAt !== "string" || Number.isNaN(Date.parse(candidate.savedAt))) return null;
  if (!isPlainObject(candidate.inputs) || !ownKeysEqual(candidate.inputs, Object.keys(FIELDS).sort())) return null;
  for (const [field, spec] of Object.entries(FIELDS)) {
    const value = candidate.inputs[field];
    if (typeof value !== "string" || value === "" || !isAllowedInput(value, spec.scale)) return null;
  }
  if (!isPlainObject(candidate.exactResults) || !ownKeysEqual(candidate.exactResults, [...exactPriceFields].sort())) return null;
  const exact = Object.fromEntries(exactPriceFields.map((field) => [field, decimalFromStored(candidate.exactResults[field])]));
  if (exactPriceFields.some((field) => exact[field] === null)) return null;
  if (!isPlainObject(candidate.displayResults) || !ownKeysEqual(candidate.displayResults, [...exactPriceFields].sort())) return null;
  if (candidate.displayResults.seedCottonPrice !== formatFixed(exact.seedCottonPrice, 2)) return null;
  if (candidate.displayResults.lintPrice !== formatFixed(exact.lintPrice, 0)) return null;
  return {
    schemaVersion: RECORDS_SCHEMA_VERSION,
    id: candidate.id,
    savedAt: new Date(candidate.savedAt).toISOString(),
    note: candidate.note,
    basis: candidate.basis,
    inputs: { ...candidate.inputs },
    exactResults: Object.fromEntries(exactPriceFields.map((field) => [field, decimalToStored(exact[field])])),
    displayResults: { ...candidate.displayResults },
  };
}

export function serializeRecords(records) {
  return JSON.stringify({ schemaVersion: RECORDS_SCHEMA_VERSION, records });
}

export function deserializeRecords(serialized) {
  if (typeof serialized !== "string") return [];
  try {
    const parsed = JSON.parse(serialized);
    if (!isPlainObject(parsed) || !ownKeysEqual(parsed, ["records", "schemaVersion"])) return [];
    if (parsed.schemaVersion !== RECORDS_SCHEMA_VERSION || !Array.isArray(parsed.records)) return [];
    const seen = new Set();
    return parsed.records.flatMap((candidate) => {
      const record = sanitizeRecordSnapshot(candidate);
      if (!record || seen.has(record.id)) return [];
      seen.add(record.id);
      return [record];
    });
  } catch {
    return [];
  }
}

export function serializeComparison(recordIds) {
  return JSON.stringify({ schemaVersion: COMPARISON_SCHEMA_VERSION, recordIds });
}

export function deserializeComparison(serialized, records) {
  if (typeof serialized !== "string") return [];
  try {
    const parsed = JSON.parse(serialized);
    if (!isPlainObject(parsed) || !ownKeysEqual(parsed, ["recordIds", "schemaVersion"])) return [];
    if (parsed.schemaVersion !== COMPARISON_SCHEMA_VERSION || !Array.isArray(parsed.recordIds)) return [];
    const validIds = new Set(records.map((record) => record.id));
    return [...new Set(parsed.recordIds)]
      .filter((id) => typeof id === "string" && validIds.has(id))
      .slice(0, MAX_COMPARISON_RECORDS);
  } catch {
    return [];
  }
}

export function normalizedCalculationKey(record) {
  return JSON.stringify({
    basis: record.basis,
    inputs: Object.fromEntries(Object.keys(FIELDS).map((field) => [field, normalizeInput(record.inputs[field])])),
    exactResults: Object.fromEntries(exactPriceFields.map((field) => {
      const exact = decimalFromStored(record.exactResults[field]);
      return [field, exact ? `${exact.numerator}/${exact.denominator}` : "invalid"];
    })),
  });
}

export function addExistingRecordToComparison(records, comparisonIds, recordId) {
  const record = records.find((item) => item.id === recordId);
  if (!record) return { ok: false, reason: "missing", records, comparisonIds };
  const compared = comparisonIds.map((id) => records.find((item) => item.id === id)).filter(Boolean);
  const key = normalizedCalculationKey(record);
  if (compared.some((item) => normalizedCalculationKey(item) === key)) {
    return { ok: false, reason: "duplicate", records, comparisonIds };
  }
  if (comparisonIds.length >= MAX_COMPARISON_RECORDS) {
    return { ok: false, reason: "full", records, comparisonIds };
  }
  return { ok: true, records, comparisonIds: [...comparisonIds, record.id] };
}

export function saveAndAddCurrentToComparison(records, comparisonIds, snapshot) {
  const compared = comparisonIds.map((id) => records.find((item) => item.id === id)).filter(Boolean);
  const snapshotKey = normalizedCalculationKey(snapshot);
  if (compared.some((item) => normalizedCalculationKey(item) === snapshotKey)) {
    return { ok: false, reason: "duplicate", records, comparisonIds };
  }
  if (comparisonIds.length >= MAX_COMPARISON_RECORDS) {
    return { ok: false, reason: "full", records, comparisonIds };
  }

  const reusable = records.find((record) => normalizedCalculationKey(record) === snapshotKey
    && (snapshot.note === "" || record.note === snapshot.note));
  if (reusable) {
    return { ok: true, reused: true, records, comparisonIds: [...comparisonIds, reusable.id] };
  }
  return { ok: true, reused: false, records: [snapshot, ...records], comparisonIds: [...comparisonIds, snapshot.id] };
}

export function buildSeedPriceComparison(records) {
  if (records.length === 0) return [];
  const entries = records.map((record) => ({
    record,
    exact: decimalFromStored(record.exactResults.seedCottonPrice),
  }));
  if (entries.some((entry) => entry.exact === null)) return [];
  const minimum = entries.reduce((current, entry) => entry.exact.compare(current) < 0 ? entry.exact : current, entries[0].exact);
  const maximum = entries.reduce((current, entry) => entry.exact.compare(current) > 0 ? entry.exact : current, entries[0].exact);
  const allSame = minimum.compare(maximum) === 0;
  const range = allSame ? null : maximum.subtract(minimum);
  return entries.map(({ record, exact }) => {
    const delta = exact.subtract(minimum);
    const position = allSame ? 50 : Number(roundHalfUp(delta.divide(range), 4)) / 100;
    let marker = `较最低 +${formatFixed(delta, 2)} 元/公斤`;
    if (allSame) marker = "相同";
    else if (exact.compare(minimum) === 0) marker = "最低";
    else if (exact.compare(maximum) === 0) marker = "最高";
    return {
      record,
      displayPrice: formatFixed(exact, 2),
      deltaDisplay: formatFixed(delta, 2),
      marker,
      position,
      allSame,
    };
  });
}

export function deleteRecord(records, comparisonIds, recordId) {
  return {
    records: records.filter((record) => record.id !== recordId),
    comparisonIds: comparisonIds.filter((id) => id !== recordId),
  };
}

export function formatRecordDateTime(savedAt) {
  const value = new Date(savedAt);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

export function searchRecords(records, query) {
  const needle = String(query ?? "").trim().toLocaleLowerCase("zh-CN");
  if (!needle) return records;
  return records.filter((record) => [
    record.note,
    record.savedAt,
    formatRecordDateTime(record.savedAt),
    record.displayResults.seedCottonPrice,
    record.displayResults.lintPrice,
  ].some((value) => String(value).toLocaleLowerCase("zh-CN").includes(needle)));
}
