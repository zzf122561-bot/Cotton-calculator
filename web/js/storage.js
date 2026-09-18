import { FIELDS, PRESET_DEFAULTS, createDefaultState, isAllowedInput, recalculate } from "./calculator.js";

export const STORAGE_KEY = "cottoncal.pwa.v1";

function cloneDefaults() {
  return {
    selectedPreset: "hand",
    hand: createDefaultState("hand"),
    machine: createDefaultState("machine"),
  };
}

function sanitizeField(candidate, field, fallback) {
  if (typeof candidate !== "string") return fallback;
  if (candidate === "") return candidate;
  if (field === "seedCottonPrice" && candidate === PRESET_DEFAULTS.hand.seedCottonPrice) return candidate;
  return isAllowedInput(candidate, FIELDS[field].scale) ? candidate : fallback;
}

function sanitizePreset(candidate, preset) {
  const fallback = PRESET_DEFAULTS[preset];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return createDefaultState(preset);
  }
  const restored = {};
  for (const field of Object.keys(FIELDS)) {
    restored[field] = sanitizeField(candidate[field], field, fallback[field]);
  }
  restored.basis = candidate.basis === "lint" || candidate.basis === "seed" ? candidate.basis : fallback.basis;
  restored.detailsExpanded = typeof candidate.detailsExpanded === "boolean"
    ? candidate.detailsExpanded
    : fallback.detailsExpanded;
  return recalculate(restored);
}

export function deserializeState(serialized) {
  if (typeof serialized !== "string") return cloneDefaults();
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return cloneDefaults();
    return {
      selectedPreset: parsed.selectedPreset === "machine" ? "machine" : "hand",
      hand: sanitizePreset(parsed.hand, "hand"),
      machine: sanitizePreset(parsed.machine, "machine"),
    };
  } catch {
    return cloneDefaults();
  }
}

export function loadState(storage = globalThis.localStorage) {
  try {
    return deserializeState(storage.getItem(STORAGE_KEY));
  } catch {
    return cloneDefaults();
  }
}

export function serializeState(appState) {
  const keep = (state) => Object.fromEntries([
    ...Object.keys(FIELDS).map((field) => [field, state[field]]),
    ["basis", state.basis],
    ["detailsExpanded", state.detailsExpanded],
  ]);
  return JSON.stringify({
    selectedPreset: appState.selectedPreset,
    hand: keep(appState.hand),
    machine: keep(appState.machine),
  });
}

export function saveState(appState, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, serializeState(appState));
    return true;
  } catch {
    return false;
  }
}
