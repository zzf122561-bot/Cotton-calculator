import { FIELDS, MACHINE_DEFAULTS, createDefaultState, isAllowedInput, recalculate } from "./calculator.js";

export const STORAGE_KEY = "cottoncal.machine.v1";

function sanitizeField(candidate, field, fallback) {
  if (typeof candidate !== "string") return fallback;
  if (candidate === "") return candidate;
  return isAllowedInput(candidate, FIELDS[field].scale) ? candidate : fallback;
}

function sanitizeMachine(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return createDefaultState();
  const restored = {};
  for (const field of Object.keys(FIELDS)) {
    restored[field] = sanitizeField(candidate[field], field, MACHINE_DEFAULTS[field]);
  }
  restored.basis = candidate.basis === "lint" || candidate.basis === "seed"
    ? candidate.basis
    : MACHINE_DEFAULTS.basis;
  return recalculate(restored);
}

export function deserializeState(serialized) {
  if (typeof serialized !== "string") return createDefaultState();
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createDefaultState();
    return sanitizeMachine(parsed.machine);
  } catch {
    return createDefaultState();
  }
}

export function loadState(storage = globalThis.localStorage) {
  try {
    return deserializeState(storage.getItem(STORAGE_KEY));
  } catch {
    return createDefaultState();
  }
}

export function serializeState(state) {
  return JSON.stringify({
    machine: Object.fromEntries([
      ...Object.keys(FIELDS).map((field) => [field, state[field]]),
      ["basis", state.basis],
    ]),
  });
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, serializeState(state));
    return true;
  } catch {
    return false;
  }
}
