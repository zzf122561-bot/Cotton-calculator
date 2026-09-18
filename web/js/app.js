import { FIELDS, PRESET_DEFAULTS, createDefaultState, editState, formatResult } from "./calculator.js";
import { buildInquirySummary, inquiryMailto } from "./inquiry.js";
import { loadState, saveState } from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";

const previewTheme = new URLSearchParams(window.location.search).get("theme");
if (previewTheme === "light" || previewTheme === "dark") {
  document.documentElement.dataset.theme = previewTheme;
}

let appState = loadState();
let themeState = applyTheme(document.documentElement, loadTheme());

const presetNames = { hand: "手摘棉", machine: "机采棉" };
const inputs = Object.fromEntries(Object.keys(FIELDS).map((field) => [field, document.getElementById(field)]));
const resetButton = document.getElementById("reset-button");
const resetDialog = document.getElementById("reset-dialog");
const contactDialog = document.getElementById("contact-dialog");
const guideDialog = document.getElementById("guide-dialog");
const themeDialog = document.getElementById("theme-dialog");
const detailToggle = document.getElementById("detail-toggle");
const customColor = document.getElementById("custom-color");
const copyStatus = document.getElementById("copy-status");

function currentState() {
  return appState[appState.selectedPreset];
}

function commitCurrent(state) {
  appState = { ...appState, [appState.selectedPreset]: state };
  saveState(appState);
  render();
}

function render() {
  const state = currentState();
  for (const [field, input] of Object.entries(inputs)) {
    if (input.value !== state[field]) input.value = state[field];
    const fieldError = state.errors.find((item) => item.field === field)?.message ?? "";
    document.getElementById(`${field}-error`).textContent = fieldError;
    document.querySelector(`[data-field-wrap="${field}"]`).classList.toggle("has-error", Boolean(fieldError));
    input.setAttribute("aria-invalid", fieldError ? "true" : "false");
  }

  for (const button of document.querySelectorAll("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === appState.selectedPreset));
  }
  for (const pill of document.querySelectorAll("[data-basis-for]")) {
    const active = pill.dataset.basisFor === state.basis;
    pill.textContent = active ? "计算依据" : "自动换算";
    pill.classList.toggle("is-passive", !active);
  }

  document.getElementById("card-error").textContent = state.errors[0]?.message ?? "";
  resetButton.textContent = `恢复${presetNames[appState.selectedPreset]}默认值`;
  document.getElementById("reset-message").textContent = `这会覆盖当前${presetNames[appState.selectedPreset]}的价格、参数和计算方向。`;

  const canShowDetails = state.result !== null;
  const expanded = state.detailsExpanded && canShowDetails;
  detailToggle.setAttribute("aria-expanded", String(expanded));
  document.getElementById("detail-body").hidden = !expanded;
  document.getElementById("detail-action").textContent = expanded ? "收起 ↑" : "展开 ↓";
  document.getElementById("detail-caption").textContent = canShowDetails ? "查看成本如何形成" : "修正输入后显示";
  const formatted = formatResult(state.result);
  if (formatted) {
    for (const [name, value] of Object.entries(formatted)) {
      document.querySelector(`[data-result="${name}"]`).textContent = value;
    }
  }

  for (const button of document.querySelectorAll("[data-palette]")) {
    button.setAttribute("aria-pressed", String(button.dataset.palette === themeState.palette));
  }
  customColor.value = themeState.customColor;

  const summary = buildInquirySummary({ presetName: presetNames[appState.selectedPreset], state, formatted });
  document.getElementById("email-inquiry").href = inquiryMailto(summary, presetNames[appState.selectedPreset]);
}

function setTheme(nextTheme) {
  themeState = applyTheme(document.documentElement, nextTheme);
  saveTheme(themeState);
  render();
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("copy failed");
}

for (const [field, input] of Object.entries(inputs)) {
  input.addEventListener("input", () => {
    const before = currentState();
    const updated = editState(before, field, input.value);
    if (updated === before && input.value.trim().replaceAll(",", "") !== before[field]) {
      input.value = before[field];
      return;
    }
    commitCurrent(updated);
  });
}

for (const button of document.querySelectorAll("[data-preset]")) {
  button.addEventListener("click", () => {
    if (button.dataset.preset === appState.selectedPreset) return;
    appState = { ...appState, selectedPreset: button.dataset.preset };
    saveState(appState);
    render();
  });
}

detailToggle.addEventListener("click", () => {
  commitCurrent({ ...currentState(), detailsExpanded: !currentState().detailsExpanded });
});

resetButton.addEventListener("click", () => resetDialog.showModal());
resetDialog.addEventListener("close", () => {
  if (resetDialog.returnValue !== "confirm") return;
  commitCurrent(createDefaultState(appState.selectedPreset));
});

document.getElementById("contact-button").addEventListener("click", () => contactDialog.showModal());
document.getElementById("contact-close").addEventListener("click", () => contactDialog.close());
document.getElementById("guide-button").addEventListener("click", () => guideDialog.showModal());
document.getElementById("guide-close").addEventListener("click", () => guideDialog.close());
document.getElementById("theme-button").addEventListener("click", () => themeDialog.showModal());
document.getElementById("theme-close").addEventListener("click", () => themeDialog.close());

for (const dialog of [contactDialog, guideDialog, themeDialog]) closeOnBackdrop(dialog);

for (const button of document.querySelectorAll("[data-palette]")) {
  button.addEventListener("click", () => {
    setTheme({ ...themeState, palette: button.dataset.palette });
  });
}

customColor.addEventListener("input", () => {
  setTheme({ palette: "custom", customColor: customColor.value });
});

document.getElementById("copy-inquiry").addEventListener("click", async () => {
  const state = currentState();
  const summary = buildInquirySummary({
    presetName: presetNames[appState.selectedPreset],
    state,
    formatted: formatResult(state.result),
  });
  try {
    await copyText(summary);
    copyStatus.textContent = "已复制。补上数量、指标、交货地和账期后发我就行。";
  } catch {
    copyStatus.textContent = "浏览器没让复制，请改用“发邮件询价”。";
  }
});

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The calculator remains fully functional when service workers are unavailable.
    });
  });
}

export { PRESET_DEFAULTS };
