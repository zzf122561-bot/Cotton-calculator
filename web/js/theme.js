export const THEME_STORAGE_KEY = "cottoncal.machine.theme.v1";
export const DEFAULT_THEME = Object.freeze({ palette: "silver", customColor: "#6f63b6" });

const PALETTES = new Set(["silver", "gold", "custom"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function sanitizeTheme(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return { ...DEFAULT_THEME };
  return {
    palette: PALETTES.has(candidate.palette) ? candidate.palette : DEFAULT_THEME.palette,
    customColor: typeof candidate.customColor === "string" && HEX_COLOR.test(candidate.customColor)
      ? candidate.customColor.toLowerCase()
      : DEFAULT_THEME.customColor,
  };
}

export function deserializeTheme(serialized) {
  if (typeof serialized !== "string") return { ...DEFAULT_THEME };
  try {
    return sanitizeTheme(JSON.parse(serialized));
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function loadTheme(storage = globalThis.localStorage) {
  try {
    return deserializeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveTheme(theme, storage = globalThis.localStorage) {
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify(sanitizeTheme(theme)));
    return true;
  } catch {
    return false;
  }
}

function readableText(hex) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;
  return luminance > 154 ? "#171819" : "#ffffff";
}

export function applyTheme(root, candidate) {
  const theme = sanitizeTheme(candidate);
  root.dataset.palette = theme.palette;
  root.style.removeProperty("--green");
  root.style.removeProperty("--on-accent");
  if (theme.palette === "custom") {
    root.style.setProperty("--green", theme.customColor);
    root.style.setProperty("--on-accent", readableText(theme.customColor));
  }
  return theme;
}
