import { FIELDS, MACHINE_DEFAULTS, editState } from "./calculator.js";
import { AccessGate, verifyPasswordCredential } from "./access-control.js";
import { ADMIN_CREDENTIAL_STORAGE_KEY, changeAdminPassword, loadAdminCredential } from "./admin-credential.js";
import { loadLedger, saveLedger } from "./ledger-storage.js";
import {
  HISTORY_PAGE_SIZE,
  addExistingRecordToComparison,
  buildSeedPriceComparison,
  createRecordSnapshot,
  deleteRecord,
  formatRecordDateTime,
  saveAndAddCurrentToComparison,
  searchRecords,
} from "./records.js";
import {
  DYNAMIC_MODULES,
  addDividerTemplateBlock,
  addStaticTemplateBlock,
  copyShareText,
  invokeSystemShare,
  loadShareTemplate,
  moveTemplateBlock,
  removeTemplateBlock,
  renderShareText,
  saveShareTemplate,
  updateTemplateBlock,
} from "./sharing.js";
import { loadState, saveState } from "./storage.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";
import {
  authenticateAuthorizedUser,
  createAuthorizedUser,
  findPasswordConflict,
  initializeAuthorizedUsers,
  resetAuthorizedUserPassword,
  saveAuthorizedUsers,
  UserMutationGate,
} from "./users.js";

const previewTheme = new URLSearchParams(window.location.search).get("theme");
if (previewTheme === "light" || previewTheme === "dark") {
  document.documentElement.dataset.theme = previewTheme;
}

let appState = loadState();
let themeState = applyTheme(document.documentElement, loadTheme());
let { records, comparisonIds } = loadLedger();
let authorizedUsers = initializeAuthorizedUsers();
let shareTemplate = loadShareTemplate();
let activeAdminCredential = loadAdminCredential();
let activeRecordsTab = "history";
let historyRenderLimit = HISTORY_PAGE_SIZE;
let activeShareRecord = null;
const userMutationGate = new UserMutationGate();

const accessGate = new AccessGate({
  authenticate: async (password) => {
    activeAdminCredential = loadAdminCredential();
    if (activeAdminCredential.credential
      && await verifyPasswordCredential(password, activeAdminCredential.credential)) return { type: "admin" };
    return authenticateAuthorizedUser(password, authorizedUsers);
  },
});

const parameterMount = document.getElementById("parameter-mount");
const unlockDialog = document.getElementById("unlock-dialog");
const unlockForm = document.getElementById("unlock-form");
const unlockPassword = document.getElementById("unlock-password");
const unlockStatus = document.getElementById("unlock-status");
const unlockSubmit = document.getElementById("unlock-submit");
const contactDialog = document.getElementById("contact-dialog");
const guideDialog = document.getElementById("guide-dialog");
const themeDialog = document.getElementById("theme-dialog");
const shareDialog = document.getElementById("share-dialog");
const adminDialog = document.getElementById("admin-dialog");
const adminCredentialForm = document.getElementById("admin-credential-form");
const adminCredentialStatus = document.getElementById("admin-credential-status");
const customColor = document.getElementById("custom-color");
const recordNote = document.getElementById("record-note");
const recordActionStatus = document.getElementById("record-action-status");
const ledgerStatus = document.getElementById("ledger-status");
const historyQuery = document.getElementById("history-query");
const historyList = document.getElementById("history-list");
const comparisonList = document.getElementById("comparison-list");
const historyLoadMore = document.getElementById("history-load-more");
let unlockFeedback = null;
let cooldownTimer = null;

const parameterSpecs = [
  ["lintPercentage", "衣分率", "%"],
  ["lossPercentage", "损耗率", "%"],
  ["cottonseedPrice", "棉籽价格", "元/kg"],
  ["processingFee", "加工费", "元/吨"],
  ["laborFee", "人工费", "元/吨"],
  ["warehouseFee", "入库费", "元/吨"],
  ["financeFee", "财务费", "元/吨"],
  ["subsidy", "补贴（冲减）", "元/吨"],
];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setStatus(node, message, isError = false) {
  node.textContent = message;
  node.classList.toggle("is-error", isError);
}

function commit(state) {
  appState = state;
  saveState(appState);
  render();
}

function attachInput(input) {
  input.addEventListener("input", () => {
    const before = appState;
    const updated = editState(before, input.dataset.field, input.value);
    if (updated === before && input.value.trim().replaceAll(",", "") !== before[input.dataset.field]) {
      input.value = before[input.dataset.field];
      return;
    }
    commit(updated);
  });
}

function createParameterCard() {
  if (document.getElementById("parameter-card")) return;
  const card = element("article", "card parameter-card settings-reveal");
  card.id = "parameter-card";
  card.setAttribute("aria-labelledby", "parameter-title");
  const title = element("h2", "", "计算参数");
  title.id = "parameter-title";
  const grid = element("div", "parameter-grid");

  for (const [field, label, unit] of parameterSpecs) {
    const wrapper = element("label", "compact-field");
    wrapper.dataset.fieldWrap = field;
    const labelText = element("span", "", label);
    const inputShell = element("span", "compact-input");
    const input = element("input");
    input.id = field;
    input.dataset.field = field;
    input.inputMode = "decimal";
    input.autocomplete = "off";
    input.setAttribute("aria-describedby", `${field}-error`);
    const unitText = element("b", "", unit);
    const error = element("small", "field-error");
    error.id = `${field}-error`;
    inputShell.append(input, unitText);
    wrapper.append(labelText, inputShell, error);
    grid.append(wrapper);
    attachInput(input);
  }

  card.append(title, grid);
  parameterMount.replaceChildren(card);
}

function removeParameterCard() {
  parameterMount.replaceChildren();
}

function render() {
  for (const field of Object.keys(FIELDS)) {
    const input = document.getElementById(field);
    if (!input) continue;
    if (input.value !== appState[field]) input.value = appState[field];
    const fieldError = appState.errors.find((item) => item.field === field)?.message ?? "";
    document.getElementById(`${field}-error`).textContent = fieldError;
    document.querySelector(`[data-field-wrap="${field}"]`).classList.toggle("has-error", Boolean(fieldError));
    input.setAttribute("aria-invalid", fieldError ? "true" : "false");
  }

  for (const pill of document.querySelectorAll("[data-basis-for]")) {
    const active = pill.dataset.basisFor === appState.basis;
    pill.textContent = active ? "计算依据" : "自动换算";
    pill.classList.toggle("is-passive", !active);
  }
  document.getElementById("card-error").textContent = appState.errors[0]?.message ?? "";

  for (const button of document.querySelectorAll("[data-palette]")) {
    button.setAttribute("aria-pressed", String(button.dataset.palette === themeState.palette));
  }
  customColor.value = themeState.customColor;
  const resultAvailable = Boolean(appState.result) && appState.errors.length === 0;
  for (const id of ["save-record", "compare-current", "share-current"]) {
    document.getElementById(id).disabled = !resultAvailable;
  }
}

function setTheme(nextTheme) {
  themeState = applyTheme(document.documentElement, nextTheme);
  saveTheme(themeState);
  render();
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog && !(dialog === adminDialog && userMutationGate.userMutationPending)) dialog.close();
  });
}

function renderUnlockStatus() {
  const remaining = accessGate.cooldownRemainingSeconds();
  if (remaining > 0) {
    unlockStatus.textContent = `尝试次数过多，请等待 ${remaining} 秒。`;
    unlockStatus.classList.add("is-error");
    unlockPassword.disabled = true;
    unlockSubmit.disabled = true;
    return;
  }

  unlockPassword.disabled = false;
  unlockSubmit.disabled = false;
  if (unlockFeedback?.status === "incorrect") {
    unlockStatus.textContent = `密码不正确，还可尝试 ${unlockFeedback.attemptsRemaining} 次。`;
    unlockStatus.classList.add("is-error");
  } else {
    unlockStatus.textContent = "此入口只用于避免误触，不是安全保护。";
    unlockStatus.classList.remove("is-error");
  }
}

function stopCooldownTimer() {
  if (cooldownTimer !== null) window.clearInterval(cooldownTimer);
  cooldownTimer = null;
}

function openUnlockDialog() {
  unlockFeedback = null;
  unlockPassword.value = "";
  renderUnlockStatus();
  unlockDialog.showModal();
  unlockPassword.focus();
  stopCooldownTimer();
  cooldownTimer = window.setInterval(() => {
    renderUnlockStatus();
    if (accessGate.cooldownRemainingSeconds() === 0) stopCooldownTimer();
  }, 250);
}

function persistLedger(successMessage, { statusNode = recordActionStatus, restoreFocus = null } = {}) {
  const persisted = saveLedger(records, comparisonIds);
  setStatus(
    statusNode,
    persisted ? successMessage : `${successMessage}；浏览器存储失败，本次仅保留在当前页面。`,
    !persisted,
  );
  renderLedger();
  restoreFocus?.();
}

function comparisonFailureMessage(reason) {
  if (reason === "duplicate") return "相同计算内容已在对比中，没有新增历史记录。";
  if (reason === "full") return "方案对比最多 4 条，没有新增历史记录。";
  return "这条历史记录已不存在。";
}

function saveCurrentRecord() {
  if (!appState.result || appState.errors.length) return;
  const snapshot = createRecordSnapshot(appState, { note: recordNote.value });
  records = [snapshot, ...records];
  recordNote.value = "";
  persistLedger("记录已保存。 ");
}

function compareCurrentRecord() {
  if (!appState.result || appState.errors.length) return;
  const snapshot = createRecordSnapshot(appState, { note: recordNote.value });
  const outcome = saveAndAddCurrentToComparison(records, comparisonIds, snapshot);
  if (!outcome.ok) {
    setStatus(recordActionStatus, comparisonFailureMessage(outcome.reason), true);
    return;
  }
  records = outcome.records;
  comparisonIds = outcome.comparisonIds;
  recordNote.value = "";
  persistLedger(outcome.reused ? "已复用最近的相同历史记录并加入方案对比。" : "已保存并加入方案对比。");
}

function createMetric(label, value) {
  const metric = element("div", "record-metric");
  metric.append(element("small", "", label), element("strong", "", value));
  return metric;
}

function actionButton(label, action, recordId, className = "", ariaLabel = "") {
  const button = element("button", `text-button ${className}`.trim(), label);
  button.type = "button";
  button.dataset.action = action;
  button.dataset.recordId = recordId;
  if (ariaLabel) button.setAttribute("aria-label", ariaLabel);
  return button;
}

function focusElement(selector, fallback) {
  const target = document.querySelector(selector) ?? fallback;
  target?.focus();
}

function recordContext(record, index) {
  const note = record.note || "未填写备注";
  return `${note}，保存于 ${formatRecordDateTime(record.savedAt)}，列表第 ${index + 1} 条`;
}

function renderHistory() {
  const filtered = searchRecords(records, historyQuery.value);
  const visible = filtered.slice(0, historyRenderLimit);
  historyList.replaceChildren();
  if (visible.length === 0) {
    historyList.append(element("p", "empty-state", historyQuery.value.trim() ? "没有匹配的历史记录。" : "保存第一条测算结果后，会显示在这里。"));
  }
  for (const [index, record] of visible.entries()) {
    const item = element("article", "record-row");
    item.dataset.recordId = record.id;
    item.tabIndex = -1;
    const heading = element("div", "record-row-heading");
    const text = element("div");
    text.append(
      element("time", "record-time", formatRecordDateTime(record.savedAt)),
      element("h3", "", record.note || "未填写备注"),
    );
    const basis = element("span", "basis-label", record.basis === "seed" ? "籽棉→皮棉" : "皮棉→籽棉");
    heading.append(text, basis);
    const metrics = element("div", "record-metrics");
    metrics.append(
      createMetric("籽棉价", `${record.displayResults.seedCottonPrice} 元/kg`),
      createMetric("现货/皮棉价", `${record.displayResults.lintPrice} 元/吨`),
    );
    const actions = element("div", "record-row-actions");
    const context = recordContext(record, index);
    item.setAttribute("aria-label", `历史记录“${context}”`);
    actions.append(
      actionButton("加入对比", "compare", record.id, "", `将历史记录“${context}”加入方案对比`),
      actionButton("分享", "share", record.id, "", `分享历史记录“${context}”`),
      actionButton("立即删除", "delete", record.id, "danger", `立即删除历史记录“${context}”`),
    );
    item.append(heading, metrics, actions);
    historyList.append(item);
  }
  historyLoadMore.hidden = visible.length >= filtered.length;
  historyLoadMore.textContent = `加载更多（剩余 ${Math.max(0, filtered.length - visible.length)} 条）`;
}

function renderComparison() {
  const compared = comparisonIds.map((id) => records.find((record) => record.id === id)).filter(Boolean);
  comparisonList.replaceChildren();
  if (compared.length === 0) {
    comparisonList.append(element("p", "empty-state", "从当前结果或历史记录加入最多 4 条方案。"));
    return;
  }
  const comparison = buildSeedPriceComparison(compared);
  for (const [index, entry] of comparison.entries()) {
    const { record } = entry;
    const item = element("article", "comparison-row");
    item.dataset.recordId = record.id;
    const heading = element("div", "record-row-heading");
    const text = element("div");
    text.append(
      element("small", "comparison-index", `方案 ${index + 1}`),
      element("h3", "", record.note || formatRecordDateTime(record.savedAt)),
    );
    heading.append(text, actionButton("移除", "remove", record.id, "danger", `从方案对比移除“${recordContext(record, index)}”`));
    const metrics = element("div", "record-metrics");
    metrics.append(
      createMetric("籽棉价", `${record.displayResults.seedCottonPrice} 元/kg`),
      createMetric("现货/皮棉价", `${record.displayResults.lintPrice} 元/吨`),
    );
    const rail = element("div", "price-delta");
    rail.setAttribute("aria-label", `籽棉单价 ${entry.displayPrice} 元每公斤，${entry.marker}`);
    const railLabel = element("div", "price-delta-label");
    railLabel.append(element("span", "", "籽棉单价差"), element("strong", "", entry.marker));
    const track = element("div", "price-delta-track");
    const marker = element("i");
    marker.style.left = `${entry.position}%`;
    track.append(marker);
    rail.append(railLabel, track);
    item.append(heading, metrics, rail);
    comparisonList.append(item);
  }
}

function renderLedger() {
  const count = document.getElementById("comparison-count");
  count.textContent = String(comparisonIds.length);
  count.setAttribute("aria-label", `${comparisonIds.length} 条`);
  renderHistory();
  renderComparison();
}

function selectRecordsTab(tab, { focus = true } = {}) {
  activeRecordsTab = tab;
  const historySelected = tab === "history";
  const historyTab = document.getElementById("history-tab");
  const comparisonTab = document.getElementById("comparison-tab");
  historyTab.setAttribute("aria-selected", String(historySelected));
  comparisonTab.setAttribute("aria-selected", String(!historySelected));
  historyTab.tabIndex = historySelected ? 0 : -1;
  comparisonTab.tabIndex = historySelected ? -1 : 0;
  document.getElementById("history-panel").hidden = !historySelected;
  document.getElementById("comparison-panel").hidden = historySelected;
  if (focus) (historySelected ? historyTab : comparisonTab).focus();
}

function openSharePreview(record) {
  activeShareRecord = record;
  document.getElementById("share-preview").textContent = renderShareText(record, shareTemplate);
  setStatus(document.getElementById("share-status"), "");
  shareDialog.showModal();
}

function currentSnapshotForSharing() {
  return createRecordSnapshot(appState, { note: recordNote.value });
}

function renderAdminUsers() {
  const list = document.getElementById("admin-user-list");
  list.replaceChildren();
  if (authorizedUsers.length === 0) list.append(element("p", "empty-state", "当前没有普通授权用户，管理员入口仍可使用。"));
  for (const [userIndex, user] of authorizedUsers.entries()) {
    const row = element("article", "admin-user-row");
    row.dataset.userId = user.id;
    const context = `用户“${user.name}”（列表第 ${userIndex + 1} 位）`;
    const state = element("span", `user-state ${user.enabled ? "enabled" : "disabled"}`, user.enabled ? "已启用" : "已停用");
    const nameLabel = element("label", "admin-inline-field");
    nameLabel.append(element("span", "", "名称"));
    const nameInput = element("input");
    nameInput.type = "text";
    nameInput.maxLength = 40;
    nameInput.value = user.name;
    nameInput.dataset.userName = user.id;
    nameInput.setAttribute("aria-label", `${context}的名称`);
    nameLabel.append(nameInput);
    const passwordLabel = element("label", "admin-inline-field");
    passwordLabel.append(element("span", "", "新密码"));
    const passwordInput = element("input");
    passwordInput.type = "password";
    passwordInput.autocomplete = "new-password";
    passwordInput.dataset.userPassword = user.id;
    passwordInput.setAttribute("aria-label", `为${context}设置新密码`);
    passwordLabel.append(passwordInput);
    const actions = element("div", "admin-row-actions");
    actions.append(
      actionButton("保存名称", "rename-user", user.id, "", `保存${context}的名称`),
      actionButton(user.enabled ? "停用" : "启用", "toggle-user", user.id, "", `${user.enabled ? "停用" : "启用"}${context}`),
      actionButton("重置密码", "reset-user", user.id, "", `重置${context}的密码`),
      actionButton("删除", "delete-user", user.id, "danger", `删除${context}`),
    );
    row.append(state, nameLabel, passwordLabel, actions);
    list.append(row);
  }
}

function templateBlockContext(block, index) {
  const position = `（模板第 ${index + 1} 项）`;
  if (block.type === "dynamic") return `动态模块“${DYNAMIC_MODULES[block.key]}”${position}`;
  if (block.type === "divider") return `分隔线模块${position}`;
  return `静态文字模块“${block.text || "空白"}”${position}`;
}

function focusTemplateControl(blockId, preferredSelector = "") {
  const row = document.querySelector(`#template-list [data-block-id="${CSS.escape(blockId)}"]`);
  let target = preferredSelector ? row?.querySelector(preferredSelector) : null;
  if (target?.disabled) target = null;
  target ??= row?.querySelector('[data-template-visible], [data-template-text], button:not(:disabled)');
  (target ?? document.getElementById("add-static-block")).focus();
}

function renderTemplateEditor() {
  const list = document.getElementById("template-list");
  list.replaceChildren();
  shareTemplate.blocks.forEach((block, index) => {
    const row = element("div", "template-row");
    row.dataset.blockId = block.id;
    const visibleLabel = element("label", "template-visible");
    const checkbox = element("input");
    checkbox.type = "checkbox";
    checkbox.checked = block.visible;
    checkbox.dataset.templateVisible = block.id;
    const context = templateBlockContext(block, index);
    checkbox.setAttribute("aria-label", `在分享中显示${context}`);
    visibleLabel.append(checkbox, element("span", "", "显示"));
    const content = element("div", "template-content");
    if (block.type === "dynamic") {
      content.append(element("small", "template-type", "动态数值"), element("strong", "", DYNAMIC_MODULES[block.key]));
    } else if (block.type === "divider") {
      content.append(element("small", "template-type", "分隔线"), element("strong", "", "————————————————"));
    } else {
      content.append(element("small", "template-type", "静态文字"));
      const input = element("input");
      input.type = "text";
      input.maxLength = 200;
      input.value = block.text;
      input.dataset.templateText = block.id;
      input.setAttribute("aria-label", `编辑${context}`);
      content.append(input);
    }
    const actions = element("div", "template-row-actions");
    const up = actionButton("上移", "move-up", block.id, "", `上移${context}`);
    up.disabled = index === 0;
    const down = actionButton("下移", "move-down", block.id, "", `下移${context}`);
    down.disabled = index === shareTemplate.blocks.length - 1;
    actions.append(up, down);
    if (block.type !== "dynamic") actions.append(actionButton("删除", "remove-block", block.id, "danger", `删除${context}`));
    row.append(visibleLabel, content, actions);
    list.append(row);
  });
}

function renderAdmin() {
  renderAdminUsers();
  renderTemplateEditor();
}

function persistUsers(message, restoreFocus = null) {
  const saved = saveAuthorizedUsers(authorizedUsers);
  setStatus(document.getElementById("user-admin-status"), saved ? message : `${message}；浏览器存储失败。`, !saved);
  renderAdminUsers();
  restoreFocus?.();
}

function persistTemplate(message, restoreFocus = null) {
  const saved = saveShareTemplate(shareTemplate);
  setStatus(document.getElementById("template-status"), saved ? message : `${message}；浏览器存储失败。`, !saved);
  renderTemplateEditor();
  restoreFocus?.();
}

function passwordConflictMessage(conflict) {
  if (conflict?.type === "admin") return "普通用户密码不能与管理员密码相同。";
  if (conflict?.type === "user") return `普通用户密码不能与用户“${conflict.name}”的密码相同。`;
  if (conflict?.type === "unavailable") return "管理员校验材料不可用，暂时无法检查密码冲突。";
  return "";
}

async function findCurrentPasswordConflict(password, users, options = {}) {
  const current = loadAdminCredential();
  if (!current.credential) return { type: "unavailable" };
  return findPasswordConflict(password, users, {
    ...options,
    verifyAdmin: (candidate, cryptoProvider) => verifyPasswordCredential(candidate, current.credential, cryptoProvider),
  });
}

function setUserMutationBusy(pending) {
  for (const id of ["user-admin-section", "admin-credential-section"]) {
    const section = document.getElementById(id);
    section.setAttribute("aria-busy", String(pending));
    for (const control of section.querySelectorAll("input, button")) control.disabled = pending;
  }
  document.getElementById("admin-exit").disabled = pending;
}

function reportUserMutationBusy() {
  setStatus(document.getElementById("user-admin-status"), "正在处理另一项用户操作，请稍候。", true);
}

for (const input of document.querySelectorAll("[data-field]")) attachInput(input);

document.getElementById("settings-trigger").addEventListener("click", () => {
  if (accessGate.registerTap()) openUnlockDialog();
});

unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (accessGate.cooldownRemainingSeconds() > 0 || !unlockPassword.value) return;
  const candidate = unlockPassword.value;
  unlockPassword.value = "";
  unlockPassword.disabled = true;
  unlockSubmit.disabled = true;
  unlockSubmit.textContent = "正在校验";
  try {
    unlockFeedback = await accessGate.submit(candidate);
  } finally {
    unlockSubmit.textContent = "验证并进入";
  }
  if (unlockFeedback.status === "unlocked") {
    stopCooldownTimer();
    unlockDialog.close();
    if (unlockFeedback.principal.type === "admin") {
      renderAdmin();
      adminDialog.showModal();
    } else {
      createParameterCard();
      render();
    }
    return;
  }
  renderUnlockStatus();
  if (accessGate.cooldownRemainingSeconds() > 0 && cooldownTimer === null) {
    cooldownTimer = window.setInterval(() => {
      renderUnlockStatus();
      if (accessGate.cooldownRemainingSeconds() === 0) stopCooldownTimer();
    }, 250);
  }
  if (!unlockPassword.disabled) unlockPassword.focus();
});

document.getElementById("unlock-cancel").addEventListener("click", () => unlockDialog.close());
unlockDialog.addEventListener("close", () => {
  unlockPassword.value = "";
  unlockFeedback = null;
  stopCooldownTimer();
});

document.getElementById("save-record").addEventListener("click", saveCurrentRecord);
document.getElementById("compare-current").addEventListener("click", compareCurrentRecord);
document.getElementById("share-current").addEventListener("click", () => openSharePreview(currentSnapshotForSharing()));
document.getElementById("history-tab").addEventListener("click", () => selectRecordsTab("history"));
document.getElementById("comparison-tab").addEventListener("click", () => selectRecordsTab("comparison"));
document.querySelector(".records-tabs").addEventListener("keydown", (event) => {
  if (!event.target.matches('[role="tab"]')) return;
  const tabs = ["history", "comparison"];
  const current = tabs.indexOf(activeRecordsTab);
  let next = current;
  if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
  else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault();
  selectRecordsTab(tabs[next]);
});
historyQuery.addEventListener("input", () => {
  historyRenderLimit = HISTORY_PAGE_SIZE;
  renderHistory();
});
historyLoadMore.addEventListener("click", () => {
  const filtered = searchRecords(records, historyQuery.value);
  const firstNewRecordId = filtered[historyRenderLimit]?.id ?? null;
  historyRenderLimit += HISTORY_PAGE_SIZE;
  renderHistory();
  if (!firstNewRecordId) {
    historyQuery.focus();
    return;
  }
  if (historyLoadMore.hidden) {
    focusElement(
      `#history-list [data-record-id="${CSS.escape(firstNewRecordId)}"] [data-action]`,
      document.querySelector(`#history-list [data-record-id="${CSS.escape(firstNewRecordId)}"]`) ?? historyQuery,
    );
  }
});
historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const record = records.find((item) => item.id === button.dataset.recordId);
  if (button.dataset.action === "share" && record) openSharePreview(record);
  if (button.dataset.action === "delete") {
    const visibleBeforeDelete = searchRecords(records, historyQuery.value);
    const visibleIndex = visibleBeforeDelete.findIndex((item) => item.id === button.dataset.recordId);
    const neighborId = visibleBeforeDelete[visibleIndex + 1]?.id ?? visibleBeforeDelete[visibleIndex - 1]?.id ?? null;
    ({ records, comparisonIds } = deleteRecord(records, comparisonIds, button.dataset.recordId));
    persistLedger("记录已删除。", {
      statusNode: ledgerStatus,
      restoreFocus: () => neighborId
        ? focusElement(`#history-list [data-record-id="${CSS.escape(neighborId)}"] [data-action="delete"]`, historyQuery)
        : historyQuery.focus(),
    });
  }
  if (button.dataset.action === "compare") {
    const outcome = addExistingRecordToComparison(records, comparisonIds, button.dataset.recordId);
    if (!outcome.ok) setStatus(ledgerStatus, comparisonFailureMessage(outcome.reason), true);
    else {
      comparisonIds = outcome.comparisonIds;
      const recordId = button.dataset.recordId;
      persistLedger("记录已加入方案对比。", {
        statusNode: ledgerStatus,
        restoreFocus: () => focusElement(
          `#history-list [data-record-id="${CSS.escape(recordId)}"] [data-action="compare"]`,
          historyQuery,
        ),
      });
    }
  }
});
comparisonList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action=remove]");
  if (!button) return;
  const index = comparisonIds.indexOf(button.dataset.recordId);
  const neighborId = comparisonIds[index + 1] ?? comparisonIds[index - 1] ?? null;
  comparisonIds = comparisonIds.filter((id) => id !== button.dataset.recordId);
  persistLedger("已从方案对比移除。", {
    statusNode: ledgerStatus,
    restoreFocus: () => neighborId
      ? focusElement(`#comparison-list [data-record-id="${CSS.escape(neighborId)}"] [data-action="remove"]`, document.getElementById("comparison-tab"))
      : document.getElementById("comparison-tab").focus(),
  });
});
document.getElementById("clear-comparison").addEventListener("click", () => {
  comparisonIds = [];
  persistLedger("方案对比已清空。", {
    statusNode: ledgerStatus,
    restoreFocus: () => document.getElementById("clear-comparison").focus(),
  });
});

document.getElementById("share-close").addEventListener("click", () => shareDialog.close());
shareDialog.addEventListener("close", () => { activeShareRecord = null; });
document.getElementById("copy-share").addEventListener("click", async () => {
  const status = document.getElementById("share-status");
  if (!activeShareRecord) return;
  const outcome = await copyShareText(renderShareText(activeShareRecord, shareTemplate));
  if (outcome.status === "copied") setStatus(status, "文本已复制。 ");
  if (outcome.status === "unavailable") setStatus(status, "当前浏览器不支持复制，请手动选择预览文本。", true);
  if (outcome.status === "error") setStatus(status, "复制失败，请手动选择预览文本。", true);
});
document.getElementById("system-share").addEventListener("click", async () => {
  const status = document.getElementById("share-status");
  if (!activeShareRecord) return;
  const outcome = await invokeSystemShare(renderShareText(activeShareRecord, shareTemplate));
  if (outcome.status === "shared") setStatus(status, "已打开系统分享。 ");
  if (outcome.status === "cancelled") setStatus(status, "已取消系统分享。", true);
  if (outcome.status === "unavailable") setStatus(status, "当前浏览器不支持系统分享，可使用复制文本。", true);
  if (outcome.status === "error") setStatus(status, "系统分享失败，测算页面不受影响。", true);
});

document.getElementById("admin-exit").addEventListener("click", () => adminDialog.close());
adminDialog.addEventListener("cancel", (event) => {
  if (userMutationGate.userMutationPending) event.preventDefault();
});
adminDialog.addEventListener("close", () => {
  adminCredentialForm.reset();
  setStatus(adminCredentialStatus, "");
  accessGate.lock();
  removeParameterCard();
  render();
});
adminCredentialForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!adminDialog.open || accessGate.principal?.type !== "admin") return;
  if (userMutationGate.userMutationPending) {
    setStatus(adminCredentialStatus, "正在处理另一项密码操作，请稍候。", true);
    return;
  }
  const currentInput = document.getElementById("admin-current-password");
  const nextInput = document.getElementById("admin-new-password");
  const confirmInput = document.getElementById("admin-confirm-password");
  const currentPassword = currentInput.value;
  const newPassword = nextInput.value;
  const confirmation = confirmInput.value;
  setStatus(adminCredentialStatus, "正在验证并保存…");
  await userMutationGate.run(async () => {
    let result;
    try {
      result = await changeAdminPassword({
        currentPassword,
        newPassword,
        confirmation,
        users: authorizedUsers,
        expectedSerialized: activeAdminCredential.serialized,
      });
    } catch {
      result = { status: "creation-failure" };
    } finally {
      adminCredentialForm.reset();
    }
    if (result.status === "changed") {
      activeAdminCredential = { status: "stored", credential: result.credential, serialized: result.serialized };
      setStatus(adminCredentialStatus, "管理员密码已在当前浏览器保存。退出后需用新密码重新解锁。");
      return;
    }
    const messages = {
      "missing-current": "请输入当前管理员密码。",
      "invalid-length": "新密码需为 8～128 个字符。",
      mismatch: "两次输入的新密码不一致。",
      "incorrect-current": "当前管理员密码不正确。",
      "same-password": "新密码不能与当前管理员密码相同。",
      "storage-unavailable": "浏览器存储不可用或校验材料损坏，密码未更改。",
      "changed-concurrently": "管理员密码已在其他页面变化，请退出并重新解锁后再试。",
      "creation-failure": "无法生成新校验材料，密码未更改。",
      "storage-failure": "浏览器存储失败，密码未更改。",
    };
    const message = result.status === "user-conflict"
      ? `新密码不能与普通用户“${result.userName}”的密码相同。`
      : messages[result.status] ?? "密码未更改，请重试。";
    setStatus(adminCredentialStatus, message, true);
  }, setUserMutationBusy);
  if (adminDialog.open) currentInput.focus();
});
window.addEventListener("storage", (event) => {
  if (event.key !== ADMIN_CREDENTIAL_STORAGE_KEY && event.key !== null) return;
  activeAdminCredential = loadAdminCredential();
  if (accessGate.principal?.type === "admin") {
    if (adminDialog.open) adminDialog.close();
    else accessGate.lock();
  }
});
document.getElementById("new-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (userMutationGate.userMutationPending) {
    reportUserMutationBusy();
    return;
  }
  const name = document.getElementById("new-user-name");
  const password = document.getElementById("new-user-password");
  let focusAfterRelease = null;
  await userMutationGate.run(async () => {
    try {
      const candidate = password.value;
      const conflict = await findCurrentPasswordConflict(candidate, authorizedUsers);
      if (conflict) {
        password.value = "";
        setStatus(document.getElementById("user-admin-status"), passwordConflictMessage(conflict), true);
        focusAfterRelease = password;
        return;
      }
      const user = await createAuthorizedUser(name.value, candidate);
      authorizedUsers = [...authorizedUsers, user];
      name.value = "";
      password.value = "";
      persistUsers("普通授权用户已新增。", () => focusElement(`[data-user-name="${CSS.escape(user.id)}"]`, document.getElementById("new-user-name")));
    } catch {
      password.value = "";
      setStatus(document.getElementById("user-admin-status"), "名称和密码不能为空。", true);
      focusAfterRelease = password;
    }
  }, setUserMutationBusy);
  focusAfterRelease?.focus();
});
document.getElementById("admin-user-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  if (userMutationGate.userMutationPending) {
    reportUserMutationBusy();
    return;
  }
  const id = button.dataset.recordId;
  const index = authorizedUsers.findIndex((user) => user.id === id);
  if (index < 0) return;
  const user = authorizedUsers[index];
  if (button.dataset.action === "delete-user") {
    const neighborId = authorizedUsers[index + 1]?.id ?? authorizedUsers[index - 1]?.id ?? null;
    authorizedUsers = authorizedUsers.filter((item) => item.id !== id);
    persistUsers("用户已删除。", () => neighborId
      ? focusElement(`#admin-user-list [data-user-id="${CSS.escape(neighborId)}"] [data-action="delete-user"]`, document.getElementById("new-user-name"))
      : document.getElementById("new-user-name").focus());
    return;
  }
  if (button.dataset.action === "toggle-user") {
    authorizedUsers = authorizedUsers.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item);
    persistUsers(user.enabled ? "用户已停用。" : "用户已启用。", () => focusElement(
      `#admin-user-list [data-user-id="${CSS.escape(id)}"] [data-action="toggle-user"]`,
      document.getElementById("new-user-name"),
    ));
    return;
  }
  if (button.dataset.action === "rename-user") {
    const input = document.querySelector(`[data-user-name="${CSS.escape(id)}"]`);
    const name = input.value.trim();
    if (!name) {
      setStatus(document.getElementById("user-admin-status"), "用户名称不能为空。", true);
      return;
    }
    authorizedUsers = authorizedUsers.map((item) => item.id === id ? { ...item, name: name.slice(0, 40) } : item);
    persistUsers("用户名称已保存。", () => focusElement(
      `#admin-user-list [data-user-id="${CSS.escape(id)}"] [data-action="rename-user"]`,
      document.getElementById("new-user-name"),
    ));
    return;
  }
  if (button.dataset.action === "reset-user") {
    const input = document.querySelector(`[data-user-password="${CSS.escape(id)}"]`);
    if (!input.value) {
      setStatus(document.getElementById("user-admin-status"), "请输入新密码。", true);
      return;
    }
    const candidate = input.value;
    let focusAfterRelease = null;
    await userMutationGate.run(async () => {
      const conflict = await findCurrentPasswordConflict(candidate, authorizedUsers, { excludeUserId: id });
      input.value = "";
      if (conflict) {
        setStatus(document.getElementById("user-admin-status"), passwordConflictMessage(conflict), true);
        focusAfterRelease = input;
        return;
      }
      const updated = await resetAuthorizedUserPassword(user, candidate);
      authorizedUsers = authorizedUsers.map((item) => item.id === id ? updated : item);
      persistUsers("用户密码已重置。", () => focusElement(
        `#admin-user-list [data-user-id="${CSS.escape(id)}"] [data-action="reset-user"]`,
        document.getElementById("new-user-name"),
      ));
    }, setUserMutationBusy);
    focusAfterRelease?.focus();
  }
});

document.getElementById("add-static-block").addEventListener("click", () => {
  shareTemplate = addStaticTemplateBlock(shareTemplate);
  const blockId = shareTemplate.blocks.at(-1).id;
  persistTemplate("静态文字已新增。", () => focusElement(`[data-template-text="${CSS.escape(blockId)}"]`, document.getElementById("add-static-block")));
});
document.getElementById("add-divider-block").addEventListener("click", () => {
  shareTemplate = addDividerTemplateBlock(shareTemplate);
  const blockId = shareTemplate.blocks.at(-1).id;
  persistTemplate("分隔线已新增。", () => focusTemplateControl(blockId, '[data-action="remove-block"]'));
});
document.getElementById("template-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.recordId;
  const index = shareTemplate.blocks.findIndex((block) => block.id === id);
  const neighborId = shareTemplate.blocks[index + 1]?.id ?? shareTemplate.blocks[index - 1]?.id ?? null;
  if (button.dataset.action === "move-up") shareTemplate = moveTemplateBlock(shareTemplate, id, -1);
  if (button.dataset.action === "move-down") shareTemplate = moveTemplateBlock(shareTemplate, id, 1);
  if (button.dataset.action === "remove-block") shareTemplate = removeTemplateBlock(shareTemplate, id);
  const removed = button.dataset.action === "remove-block";
  persistTemplate("分享模板已保存。", () => {
    if (!removed) {
      focusTemplateControl(id, `[data-action="${button.dataset.action}"]`);
    } else if (neighborId) {
      focusTemplateControl(neighborId, '[data-action="remove-block"]');
    } else {
      document.getElementById("add-static-block").focus();
    }
  });
});
document.getElementById("template-list").addEventListener("change", (event) => {
  if (event.target.matches("[data-template-visible]")) {
    const id = event.target.dataset.templateVisible;
    shareTemplate = updateTemplateBlock(shareTemplate, id, { visible: event.target.checked });
    persistTemplate("模块显示状态已保存。", () => focusTemplateControl(id, "[data-template-visible]"));
  }
  if (event.target.matches("[data-template-text]")) {
    const id = event.target.dataset.templateText;
    shareTemplate = updateTemplateBlock(shareTemplate, id, { text: event.target.value });
    persistTemplate("静态文字已保存。", () => focusTemplateControl(id, "[data-template-text]"));
  }
});

document.getElementById("contact-button").addEventListener("click", () => contactDialog.showModal());
document.getElementById("contact-close").addEventListener("click", () => contactDialog.close());
document.getElementById("guide-button").addEventListener("click", () => guideDialog.showModal());
document.getElementById("guide-close").addEventListener("click", () => guideDialog.close());
document.getElementById("theme-button").addEventListener("click", () => themeDialog.showModal());
document.getElementById("theme-close").addEventListener("click", () => themeDialog.close());

for (const dialog of [unlockDialog, contactDialog, guideDialog, themeDialog, shareDialog, adminDialog]) closeOnBackdrop(dialog);

for (const button of document.querySelectorAll("[data-palette]")) {
  button.addEventListener("click", () => setTheme({ ...themeState, palette: button.dataset.palette }));
}

customColor.addEventListener("input", () => {
  setTheme({ palette: "custom", customColor: customColor.value });
});

render();
renderLedger();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The calculator remains functional when service workers are unavailable.
    });
  });
}

export { MACHINE_DEFAULTS, accessGate };
