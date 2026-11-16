import { FIELDS, MACHINE_DEFAULTS, createDefaultState, recalculate, editState } from "./calculator.js";
import { TenTapTrigger } from "./access-control.js";
import { CloudClient, OperationGate, migrateCloudStorage } from "./cloud-client.js";
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
  createDefaultShareTemplate,
  moveTemplateBlock,
  removeTemplateBlock,
  renderShareText,
  updateTemplateBlock,
} from "./sharing.js";
import { applyTheme, loadTheme, saveTheme } from "./theme.js";
const previewTheme = new URLSearchParams(window.location.search).get("theme");
if (previewTheme === "light" || previewTheme === "dark") {
  document.documentElement.dataset.theme = previewTheme;
}

const api = new CloudClient();
const tapTrigger = new TenTapTrigger();
const userMutationGate = new OperationGate();
const legacyLedger = loadLedger();
let appState = createDefaultState();
let themeState = applyTheme(document.documentElement, loadTheme());
let records = [], comparisonIds = [], authorizedUsers = [];
let shareTemplate = createDefaultShareTemplate();
let configVersion = 0, configDirty = false, configReadSequence = 0, cooldownUntil = 0;
let activeRecordsTab = "history";
let historyRenderLimit = HISTORY_PAGE_SIZE;
let activeShareRecord = null;

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
const settingsDialog = document.getElementById("settings-dialog");
const cloudStatus = document.getElementById("cloud-status");
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
  if (node === cloudStatus) {
    const mirror = document.getElementById("settings-cloud-status");
    mirror.textContent = message; mirror.classList.toggle("is-error", isError);
  }
}

function commit(state) {
  appState = state;
  if (api.role === "settings") configDirty = true;
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
  document.getElementById("settings-tools").hidden = api.role !== "settings";
  document.getElementById("lock-settings").hidden = api.role !== "settings";
  for (const id of ["seedCottonPrice", "lintPrice"]) document.getElementById(id).disabled = !api.user;
  updateTemplatePreview();
  const resultAvailable = Boolean(appState.result) && appState.errors.length === 0;
  for (const id of ["save-record", "compare-current", "share-current"]) {
    document.getElementById(id).disabled = !resultAvailable || !api.user;
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
  const remaining = Math.ceil(Math.max(0, cooldownUntil - Date.now()) / 1000);
  unlockPassword.disabled = remaining > 0;
  unlockSubmit.disabled = remaining > 0;
  setStatus(unlockStatus, remaining > 0 ? "请等待 " + remaining + " 秒后再验证。" : (unlockFeedback || "请输入当前用户的一级密码，或二级管理密码。"), Boolean(remaining || unlockFeedback));
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
    if (Date.now() >= cooldownUntil) stopCooldownTimer();
  }, 250);
}

function persistLedger(successMessage, { statusNode = recordActionStatus, restoreFocus = null } = {}) {
  if (!api.user) return;
  const persisted = saveLedger(records, comparisonIds, undefined, api.user.id);
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
  if (!authorizedUsers.length) list.append(element("p", "empty-state", "当前没有可用用户，可新增用户。"));
  for (const [index, user] of authorizedUsers.entries()) {
    const row = element("article", "admin-user-row");
    row.dataset.userId = user.id;
    const context = "用户“" + user.name + "”（列表第 " + (index + 1) + " 位）";
    const nameLabel = element("label", "admin-inline-field");
    nameLabel.append(element("span", "", "名称"));
    const name = element("input"); name.value = user.name; name.maxLength = 40; name.dataset.userName = user.id;
    name.setAttribute("aria-label", context + "的名称"); nameLabel.append(name);
    const reset = element("div", "reset-user-fields");
    const kind = element("select"); kind.dataset.userKind = user.id; kind.setAttribute("aria-label", context + "要重置的密码");
    for (const [value, text] of [["door", "门板密码"], ["settings", "一级密码"]]) { const option = element("option", "", text); option.value = value; kind.append(option); }
    reset.append(kind);
    for (const [key, text] of [["userPassword", "新密码"], ["userConfirm", "确认新密码"]]) {
      const label = element("label", "admin-inline-field"); label.append(element("span", "", text));
      const input = element("input"); input.type = "password"; input.autocomplete = "new-password"; input.maxLength = 128;
      input.dataset[key] = user.id; input.setAttribute("aria-label", context + "的" + text); label.append(input); reset.append(label);
    }
    const actions = element("div", "admin-row-actions");
    for (const [label, action] of [["保存名称", "rename-user"], [user.enabled ? "停用" : "启用", "toggle-user"], ["重置所选密码", "reset-user"], ["删除", "delete-user"]]) {
      actions.append(actionButton(label, action, user.id, action === "delete-user" ? "danger" : "", context + label));
    }
    row.append(element("span", "user-state " + (user.enabled ? "enabled" : "disabled"), user.enabled ? "已启用" : "已停用"), nameLabel, reset, actions);
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

function updateTemplatePreview() {
  const node = document.getElementById("template-preview");
  if (node) node.textContent = appState.result && !appState.errors.length ? renderShareText(currentSnapshotForSharing(), shareTemplate) : "当前计算无有效结果，请核对输入。";
}

function persistTemplate(message, restoreFocus = null) {
  if (api.role !== "settings") return;
  configDirty = true;
  setStatus(document.getElementById("template-status"), message + " 请保存云端配置。");
  renderTemplateEditor(); updateTemplatePreview(); restoreFocus?.();
}

function setUserMutationBusy(pending) {
  for (const id of ["user-admin-section", "admin-credential-section", "own-password-section"]) {
    const section = document.getElementById(id); section.setAttribute("aria-busy", String(pending));
    for (const control of section.querySelectorAll("input, select, button")) control.disabled = pending;
  }
  document.getElementById("admin-exit").disabled = pending;
}

async function refreshAdminUsers() {
  authorizedUsers = await api.request("/admin/users");
  renderAdminUsers();
}

async function refreshConfig(force = false) {
  if (!api.user) return false;
  const uid = api.user.id, sequence = ++configReadSequence;
  try {
    const data = await api.request("/me/config");
    if (sequence !== configReadSequence || api.user?.id !== uid) return false;
    if (configDirty && !force) {
      setStatus(cloudStatus, data.version !== configVersion ? "配置已在其他会话变化；请重新读取后编辑，未覆盖你的草稿。" : "当前有未保存草稿，请保存或重新读取。", data.version !== configVersion);
      return false;
    }
    appState = recalculate(data.machine); shareTemplate = data.template; configVersion = data.version; configDirty = false;
    setStatus(cloudStatus, "已读取最新配置。");
    render(); if (settingsDialog.open) renderTemplateEditor();
    return true;
  } catch (error) {
    setStatus(cloudStatus, error.message, true);
    if (error.status === 401 || error.status === 403) { api.lock(); removeParameterCard(); if (settingsDialog.open) settingsDialog.close(); }
    return false;
  }
}

function showDoor() {
  configReadSequence++; api.lock(); tapTrigger.reset(); removeParameterCard();
  if (adminDialog.open) adminDialog.close();
  if (settingsDialog.open) settingsDialog.close();
  if (shareDialog.open) shareDialog.close();
  appState = createDefaultState(); shareTemplate = createDefaultShareTemplate(); records = []; comparisonIds = []; configDirty = false;
  document.getElementById("calculator-content").hidden = true;
  document.getElementById("session-toolbar").hidden = true;
  document.getElementById("door-panel").hidden = false;
  document.getElementById("door-submit").disabled = true;
  document.getElementById("door-password").value = "";
  recordNote.value = ""; historyQuery.value = ""; render(); renderLedger();
}

function renderLegacy() {
  const list = document.getElementById("legacy-history-list"); list.replaceChildren();
  document.getElementById("legacy-ledger").hidden = !legacyLedger.records.length;
  document.getElementById("legacy-count").textContent = legacyLedger.records.length + " 条旧历史，" + legacyLedger.comparisonIds.length + " 条旧对比链接；未分配给新用户。";
  for (const record of legacyLedger.records) {
    const row = element("article", "record-row");
    row.append(element("p", "", (record.note || "旧测算") + " · " + formatRecordDateTime(record.savedAt)));
    const share = actionButton("分享旧快照", "legacy-share", record.id); share.addEventListener("click", () => openSharePreview(record));
    row.append(share); list.append(row);
  }
}

async function enterUser() {
  if (!api.user) return showDoor();
  if (!await refreshConfig(true)) {
    const message = cloudStatus.textContent; showDoor();
    setStatus(document.getElementById("door-status"), message, true);
    return;
  }
  ({ records, comparisonIds } = loadLedger(undefined, api.user.id));
  document.getElementById("door-panel").hidden = true;
  document.getElementById("calculator-content").hidden = false;
  document.getElementById("session-toolbar").hidden = false;
  document.getElementById("current-user").textContent = api.user.name;
  historyRenderLimit = HISTORY_PAGE_SIZE;
  renderLedger(); renderLegacy();
}

async function startCloud() {
  showDoor();
  try {
    await api.initialize();
    const users = await api.request("/users");
    const select = document.getElementById("door-user"); select.replaceChildren();
    for (const user of users) { const option = element("option", "", user.name); option.value = user.id; select.append(option); }
    document.getElementById("door-submit").disabled = !users.length;
    setStatus(document.getElementById("door-status"), users.length ? "请选择用户名并输入门板密码。" : "暂时没有启用用户，请联系管理员。");
    if (api.user) await enterUser();
  } catch (error) { setStatus(document.getElementById("door-status"), error.message, true); document.getElementById("door-submit").disabled = true; }
}

async function leaveSession() {
  let message = "";
  showDoor();
  try { await api.logout(); } catch (error) { message = error.message + " 页面已清空，服务器退出待联网完成。"; }
  showDoor();
  if (message) setStatus(document.getElementById("door-status"), message, true);
  else await startCloud();
}

document.getElementById("door-retry").addEventListener("click", startCloud);
document.getElementById("switch-user").addEventListener("click", leaveSession);
document.getElementById("door-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = document.getElementById("door-password"), password = input.value; input.value = "";
  document.getElementById("door-submit").disabled = true;
  try { await api.login(document.getElementById("door-user").value, password); await enterUser(); }
  catch (error) { setStatus(document.getElementById("door-status"), error.message, true); }
  finally { document.getElementById("door-submit").disabled = false; }
});
document.getElementById("reload-cloud").addEventListener("click", () => refreshConfig(true));
document.getElementById("save-cloud").addEventListener("click", async () => {
  if (api.role !== "settings" || !api.user || !appState.result || appState.errors.length) return;
  const button = document.getElementById("save-cloud"); button.disabled = true;
  try {
    const machine = Object.fromEntries([...Object.keys(FIELDS).map((field) => [field, appState[field]]), ["basis", appState.basis]]);
    const result = await api.request("/me/config", "PUT", { version: configVersion, machine, template: shareTemplate });
    configVersion = result.version; configDirty = false; setStatus(cloudStatus, "参数与分享模板已保存到服务器。");
  } catch (error) { setStatus(cloudStatus, error.message, true); if (error.status === 401 || error.status === 403) { api.lock(); removeParameterCard(); settingsDialog.close(); render(); } }
  finally { button.disabled = false; }
});
document.getElementById("settings-tools").addEventListener("click", () => { if (api.role === "settings") { renderTemplateEditor(); updateTemplatePreview(); settingsDialog.showModal(); } });
document.getElementById("settings-close").addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("close", () => document.getElementById("own-password-form").reset());
document.getElementById("lock-settings").addEventListener("click", () => { api.lock(); removeParameterCard(); if (settingsDialog.open) settingsDialog.close(); render(); });
window.addEventListener("focus", async () => {
  if (!api.user) return;
  try {
    const session = await api.request("/session");
    if (!session.user || session.user.id !== api.user.id) { api.clear(); await startCloud(); return; }
    await refreshConfig();
  } catch (error) { setStatus(cloudStatus, error.message, true); }
});
window.addEventListener("offline", () => { setStatus(cloudStatus, "网络已断开；无法登录、解锁或保存云端配置。", true); });

for (const input of document.querySelectorAll("[data-field]")) attachInput(input);

document.getElementById("settings-trigger").addEventListener("click", () => {
  if (api.role !== "admin" && tapTrigger.registerTap()) openUnlockDialog();
});
unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (Date.now() < cooldownUntil || !unlockPassword.value || unlockSubmit.disabled) return;
  const candidate = unlockPassword.value; unlockPassword.value = "";
  unlockPassword.disabled = true; unlockSubmit.disabled = true;
  try {
    const role = await api.unlock(candidate);
    unlockDialog.close();
    if (role === "admin") { removeParameterCard(); render(); await refreshAdminUsers(); adminDialog.showModal(); }
    else if (await refreshConfig(true)) { createParameterCard(); render(); }
    else { api.lock(); render(); }
  } catch (error) {
    unlockFeedback = error.message;
    if (error.seconds) cooldownUntil = Date.now() + error.seconds * 1000;
    removeParameterCard(); render(); renderUnlockStatus();
    stopCooldownTimer(); cooldownTimer = window.setInterval(() => { renderUnlockStatus(); if (Date.now() >= cooldownUntil) stopCooldownTimer(); }, 250);
  } finally { if (Date.now() >= cooldownUntil) { unlockPassword.disabled = false; unlockSubmit.disabled = false; } }
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

document.getElementById("admin-exit").addEventListener("click", leaveSession);
adminDialog.addEventListener("cancel", (event) => { if (userMutationGate.userMutationPending) event.preventDefault(); });
adminDialog.addEventListener("close", () => { adminCredentialForm.reset(); document.getElementById("new-user-form").reset(); api.lock(); removeParameterCard(); render(); });
adminCredentialForm.addEventListener("submit", async (event) => {
  event.preventDefault(); if (api.role !== "admin" || !adminDialog.open) return;
  const body = { currentPassword: document.getElementById("admin-current-password").value, newPassword: document.getElementById("admin-new-password").value, confirmation: document.getElementById("admin-confirm-password").value };
  await userMutationGate.run(async () => {
    try { await api.request("/admin/password", "POST", body); api.clear(); await startCloud(); setStatus(document.getElementById("door-status"), "二级密码已更改，请重新进入。"); }
    catch (error) { setStatus(adminCredentialStatus, error.message, true); }
    finally { adminCredentialForm.reset(); }
  }, setUserMutationBusy);
});
document.getElementById("own-password-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (api.role !== "settings") return;
  const form = event.currentTarget, status = document.getElementById("own-password-status");
  const body = { currentPassword: document.getElementById("own-current-password").value, newPassword: document.getElementById("own-new-password").value, confirmation: document.getElementById("own-confirm-password").value };
  const kind = document.getElementById("own-password-kind").value;
  await userMutationGate.run(async () => {
    try { await api.request("/me/password/" + kind, "POST", body); api.clear(); await startCloud(); setStatus(document.getElementById("door-status"), "密码已更改，旧会话已撤销，请重新登录。"); }
    catch (error) { setStatus(status, error.message, true); }
    finally { form.reset(); }
  }, setUserMutationBusy);
});
document.getElementById("new-user-form").addEventListener("submit", async (event) => {
  event.preventDefault(); if (api.role !== "admin" || userMutationGate.userMutationPending) return;
  const body = { name: document.getElementById("new-user-name").value,
    doorPassword: document.getElementById("new-user-door").value, doorConfirmation: document.getElementById("new-user-door-confirm").value,
    settingsPassword: document.getElementById("new-user-password").value, settingsConfirmation: document.getElementById("new-user-confirm").value };
  await userMutationGate.run(async () => {
    try { await api.request("/admin/users", "POST", body); event.target.reset(); await refreshAdminUsers(); setStatus(document.getElementById("user-admin-status"), "用户已在服务器创建。"); }
    catch (error) { setStatus(document.getElementById("user-admin-status"), error.message, true); }
    finally { for (const input of event.target.querySelectorAll('input[type="password"]')) input.value = ""; }
  }, setUserMutationBusy);
});
document.getElementById("admin-user-list").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || api.role !== "admin" || userMutationGate.userMutationPending) return;
  const id = button.dataset.recordId, user = authorizedUsers.find((item) => item.id === id);
  if (!user) return;
  const row = button.closest(".admin-user-row");
  await userMutationGate.run(async () => {
    try {
      const path = "/admin/users/" + encodeURIComponent(id);
      if (button.dataset.action === "delete-user") await api.request(path, "DELETE");
      if (button.dataset.action === "toggle-user") await api.request(path, "PATCH", { enabled: !user.enabled });
      if (button.dataset.action === "rename-user") await api.request(path, "PATCH", { name: row.querySelector("[data-user-name]").value });
      if (button.dataset.action === "reset-user") await api.request(path + "/password/" + row.querySelector("[data-user-kind]").value, "POST", { newPassword: row.querySelector("[data-user-password]").value, confirmation: row.querySelector("[data-user-confirm]").value });
      await refreshAdminUsers(); setStatus(document.getElementById("user-admin-status"), "用户设置已在服务器更新。");
    } catch (error) { setStatus(document.getElementById("user-admin-status"), error.message, true); }
    finally { for (const input of row.querySelectorAll('input[type="password"]')) input.value = ""; }
  }, setUserMutationBusy);
});

document.getElementById("add-static-block").addEventListener("click", () => {
  if (api.role !== "settings") return;
  shareTemplate = addStaticTemplateBlock(shareTemplate);
  const blockId = shareTemplate.blocks.at(-1).id;
  persistTemplate("静态文字已新增。", () => focusElement(`[data-template-text="${CSS.escape(blockId)}"]`, document.getElementById("add-static-block")));
});
document.getElementById("add-divider-block").addEventListener("click", () => {
  if (api.role !== "settings") return;
  shareTemplate = addDividerTemplateBlock(shareTemplate);
  const blockId = shareTemplate.blocks.at(-1).id;
  persistTemplate("分隔线已新增。", () => focusTemplateControl(blockId, '[data-action="remove-block"]'));
});
document.getElementById("template-list").addEventListener("click", (event) => {
  if (api.role !== "settings") return;
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
  if (api.role !== "settings") return;
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

for (const dialog of [unlockDialog, contactDialog, guideDialog, themeDialog, shareDialog, adminDialog, settingsDialog]) closeOnBackdrop(dialog);

for (const button of document.querySelectorAll("[data-palette]")) {
  button.addEventListener("click", () => setTheme({ ...themeState, palette: button.dataset.palette }));
}

customColor.addEventListener("input", () => {
  setTheme({ palette: "custom", customColor: customColor.value });
});

render();
renderLedger();
migrateCloudStorage();
startCloud();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The calculator remains functional when service workers are unavailable.
    });
  });
}

export { MACHINE_DEFAULTS, api };
