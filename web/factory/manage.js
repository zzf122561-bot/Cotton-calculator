import { $, PARAMETERS, LABELS, element, button, status, readableTime, LatestIntent } from "./shared.js";
import { ManagementSession } from "./management-session.js";

const intent = new LatestIntent();
let identity, factories = [], selectedId = "", config, template = [], previewBody = "", dirty = false, busy = false, previewTimer;
let resetPending = null;
const controls = {};
const downloadUrls = new Set();
const api = new ManagementSession({ onEnd: clearManagement });
const plant = () => factories.find((item) => item.id === selectedId);
const platform = () => identity?.role === "platform";
const canEditTemplate = () => platform() || Boolean(plant()?.shareEditable);
const editable = (key) => platform() || Boolean(plant()?.editable.includes(key));
const ticket = () => ({ epoch: api.epoch, identity });
const current = (scope) => scope.epoch === api.epoch && scope.identity === identity && Boolean(identity) && api.check();

function clearManagement(message = "") {
  clearTimeout(previewTimer); intent.invalidate();
  identity = undefined; factories = []; selectedId = ""; config = undefined; template = []; previewBody = "";
  dirty = false; busy = false; resetPending = null;
  for (const key of Object.keys(controls)) delete controls[key];
  for (const url of downloadUrls) URL.revokeObjectURL(url);
  downloadUrls.clear();
  for (const node of document.querySelectorAll("input, textarea, select")) { node.value = ""; node.checked = false; }
  for (const node of document.querySelectorAll("details")) node.open = false;
  for (const id of ["factory-select", "parameter-fields", "permission-fields", "template-editor", "contacts"]) $(id).replaceChildren();
  for (const id of ["manager-name", "factory-info", "factory-code", "config-title", "config-version", "template-permission", "config-preview", "contact-count"]) $(id).textContent = "";
  for (const id of ["management", "management-heading", "new-factory", "config-panel", "permissions-panel", "contacts-panel", "logout"]) $(id).hidden = true;
  $("login-panel").hidden = false;
  $("management-lock").disabled = false;
  $("login-button").disabled = true;
  $("publish-config").disabled = true;
  $("connect-retry").hidden = false;
  $("connect-retry").disabled = false;
  status(message);
}
async function run(action, { discard = false, login = false } = {}) {
  if (login ? !api.ready : !identity || !api.check()) return;
  if (busy || (discard && dirty && !confirm("此操作会放弃尚未发布的参数和文案修改。继续吗？"))) {
    $("factory-select").value = selectedId;
    return;
  }
  const epoch = api.epoch;
  busy = true;
  // Native fieldset locking covers newly rendered controls without changing their permissions.
  $("management-lock").disabled = true;
  try { await action(); }
  catch (error) { if (epoch === api.epoch && !error.silent) status(error.message, true); }
  finally {
    if (epoch === api.epoch) {
      busy = false;
      $("management-lock").disabled = false;
      $("login-button").disabled = !api.ready;
    }
  }
}
function modified() {
  if (!identity || !api.check()) return;
  dirty = true; previewBody = ""; intent.invalidate();
  $("publish-config").disabled = true;
  $("config-preview").textContent = "内容已修改，正在生成预览…";
  clearTimeout(previewTimer); previewTimer = setTimeout(preview, 500);
}
function body() {
  return { version: config.version, parameters: Object.fromEntries(Object.entries(controls).map(([key, input]) => [key, input.value.trim()])), template };
}
async function preview() {
  clearTimeout(previewTimer);
  if (!config || !identity || !api.check()) return;
  const scope = ticket(), token = intent.version, target = selectedId, payload = body();
  try {
    const result = await api.call(`/config/${target}/preview`, "POST", payload);
    if (!current(scope) || !intent.isCurrent(token) || target !== selectedId) return;
    previewBody = JSON.stringify(payload);
    $("config-preview").textContent = result.shareText;
    $("publish-config").disabled = false;
  } catch (error) {
    if (!error.silent && current(scope) && intent.isCurrent(token) && target === selectedId) {
      previewBody = ""; $("publish-config").disabled = true;
      $("config-preview").textContent = `预览未完成：${error.message}`;
      status(error.message, true);
    }
  }
}
function renderEditor() {
  const allowed = canEditTemplate();
  $("add-text").disabled = !allowed;
  $("template-permission").textContent = allowed ? "文字可修改；测算数字由系统填写。用上移、下移调整顺序。" : "平台尚未开放文案编辑。可以查看当前模板和预览。";
  $("template-editor").replaceChildren(...template.map((block, index) => {
    const container = element("div", undefined, "editor-block");
    const checkLabel = element("label", undefined, "check"), check = element("input");
    check.type = "checkbox"; check.checked = block.visible; check.disabled = !allowed;
    checkLabel.append(check, document.createTextNode(block.type === "field" ? LABELS[block.key] : "文字段落"));
    check.onchange = () => { block.visible = check.checked; modified(); };
    container.append(checkLabel);
    if (block.type === "text") {
      const input = element("textarea"); input.value = block.text; input.rows = 3; input.maxLength = 500;
      input.disabled = !allowed; input.setAttribute("aria-label", `第 ${index + 1} 段分享文字`);
      input.oninput = () => { block.text = input.value; modified(); };
      container.append(input);
    } else container.append(element("p", "自动填写本次测算值", "help"));
    const actions = element("div", undefined, "actions");
    const move = (offset) => { [template[index], template[index + offset]] = [template[index + offset], template[index]]; modified(); renderEditor(); };
    const up = button("上移", () => move(-1)), down = button("下移", () => move(1));
    up.disabled = !allowed || index === 0; down.disabled = !allowed || index === template.length - 1;
    actions.append(up, down);
    if (block.type === "text") {
      const remove = button("删除此段", () => { template.splice(index, 1); modified(); renderEditor(); });
      remove.disabled = !allowed; actions.append(remove);
    }
    container.append(actions); return container;
  }));
}
function renderParameters() {
  for (const key of Object.keys(controls)) delete controls[key];
  $("parameter-fields").replaceChildren(...Object.entries(PARAMETERS).map(([key, [label, unit]]) => {
    const container = element("div"), title = element("label", `${label}（${unit}）`), input = element("input");
    input.id = "parameter-" + key; title.htmlFor = input.id;
    input.value = config.parameters[key]; input.inputMode = key === "basisPrice" ? "text" : "decimal";
    input.disabled = !editable(key); input.maxLength = 24; input.oninput = modified;
    controls[key] = input; container.append(title, input);
    if (!editable(key)) container.append(element("small", "由平台管理"));
    return container;
  }));
}
async function loadConfig() {
  clearTimeout(previewTimer); intent.invalidate(); previewBody = "";
  $("publish-config").disabled = true;
  const scope = ticket(), target = selectedId, token = intent.version;
  const next = await api.call(`/config/${target}`);
  if (!current(scope) || target !== selectedId || !intent.isCurrent(token)) return;
  config = next; template = structuredClone(next.template); dirty = false;
  $("config-panel").hidden = false;
  $("config-title").textContent = selectedId === "defaults" ? "新厂默认参数与文案" : "本厂计算参数与文案";
  $("config-version").textContent = `当前第 ${config.version} 版${selectedId === "defaults" ? " · 仅用于以后新建的加工厂" : ""}`;
  renderParameters(); renderEditor(); await preview();
}
function renderPermissions() {
  const current = plant();
  $("permissions-panel").hidden = !platform() || !current;
  if (!current) return;
  $("edit-name").value = current.name; $("factory-enabled").checked = current.enabled;
  $("share-permission").checked = current.shareEditable;
  $("permission-fields").replaceChildren(...Object.entries(PARAMETERS).map(([key, [label]]) => {
    const row = element("label", undefined, "check"), check = element("input");
    check.type = "checkbox"; check.value = key; check.checked = current.editable.includes(key);
    row.append(check, document.createTextNode(label)); return row;
  }));
}
async function loadContacts() {
  if (selectedId === "defaults") { $("contacts-panel").hidden = true; return; }
  const scope = ticket(), target = selectedId;
  const data = await api.call(`/factories/${target}/contacts`);
  if (!current(scope) || target !== selectedId) return;
  $("contacts-panel").hidden = false;
  $("contact-count").textContent = `共 ${data.contacts.length} 个手机号`;
  $("contacts").replaceChildren(...(data.contacts.length ? data.contacts.map((contact) => {
    const row = element("article", undefined, "customer");
    row.append(element("strong", contact.phone + "（未核验）"), element("p", `收集时间：${readableTime(contact.created)}`, "help"));
    return row;
  }) : [element("p", "还没有收到手机号。", "empty")]));
}
async function selectFactory(id) {
  const scope = ticket();
  if (!current(scope)) return;
  selectedId = id; config = null; intent.invalidate();
  $("factory-select").value = id;
  $("config-panel").hidden = true; $("contacts-panel").hidden = true;
  const selected = plant();
  $("factory-info").textContent = selected ? `${selected.name} · ${selected.enabled ? "已启用" : "已停用"} · 管理账号：${selected.username} · 推广厂码` : "这里的默认值只用于新建加工厂，不会覆盖已有厂的设置。";
  $("factory-code").textContent = selected?.code || "";
  renderPermissions(); await loadConfig();
  if (current(scope) && id === selectedId) await loadContacts();
}
async function loadFactories(preferred = selectedId) {
  const scope = ticket(), data = await api.call("/factories");
  if (!current(scope)) return;
  factories = data.factories;
  const choices = [...(platform() ? [{ id: "defaults", name: "新厂默认配置" }] : []), ...factories];
  $("factory-select").replaceChildren(...choices.map((item) => { const option = element("option", item.name); option.value = item.id; return option; }));
  selectedId = choices.some((item) => item.id === preferred) ? preferred : choices[0]?.id;
  $("factory-select").value = selectedId;
  await selectFactory(selectedId);
}
async function showManagement() {
  const scope = ticket();
  if (!current(scope)) return;
  $("login-panel").hidden = true; $("management").hidden = false;
  $("management-heading").hidden = false;
  $("logout").hidden = false;
  $("manager-name").textContent = `${platform() ? "平台总管理员" : "厂方管理员"} · ${identity.username}`;
  $("new-factory").hidden = !platform();
  await loadFactories(); if (current(scope)) status();
}
async function finishReset(pending, message = "") {
  const epoch = api.epoch;
  resetPending = pending;
  $("connect-retry").disabled = true;
  try {
    await pending;
    if (epoch !== api.epoch) return;
    $("login-button").disabled = !api.ready;
    $("connect-retry").hidden = api.ready;
    status(message);
  } catch (error) {
    if (epoch === api.epoch && !error.silent) { status(error.message, true); $("connect-retry").hidden = false; }
  } finally {
    if (epoch === api.epoch) { resetPending = null; $("connect-retry").disabled = false; }
  }
}
function start() {
  return resetPending || finishReset(api.reset());
}
$("login-form").onsubmit = (event) => { event.preventDefault(); run(async () => {
  const epoch = api.epoch;
  const next = await api.login($("username").value, $("password").value);
  if (epoch !== api.epoch || !api.check()) return;
  $("password").value = ""; identity = next; await showManagement();
}, { login: true }); };
$("logout").onclick = () => finishReset(api.logout(), "已退出后台，请重新登录。");
$("factory-select").onchange = () => {
  const next = $("factory-select").value;
  run(() => selectFactory(next), { discard: true });
};
$("reload-config").onclick = () => {
  run(() => loadFactories(selectedId), { discard: true });
};
$("add-text").onclick = () => {
  if (!identity || !api.check() || busy || !canEditTemplate()) return;
  if (template.length >= 40) { status("最多 40 个内容块。", true); return; }
  template.push({ id: "text-" + crypto.randomUUID(), type: "text", text: "", visible: true }); modified(); renderEditor();
};
$("preview-config").onclick = () => run(preview);
$("publish-config").onclick = () => run(async () => {
  const scope = ticket(), target = selectedId, payload = body();
  if (JSON.stringify(payload) !== previewBody) throw new Error("请先更新预览，再发布。");
  await api.call(`/config/${target}`, "PUT", payload);
  if (!current(scope) || target !== selectedId) return;
  dirty = false; await loadFactories(target);
  if (current(scope)) status("配置已发布，下一次测算使用新配置。");
});
$("create-form").onsubmit = (event) => { event.preventDefault(); run(async () => {
  const scope = ticket();
  const created = await api.call("/factories", "POST", { name: $("new-name").value, username: $("new-username").value,
    password: $("new-password").value, confirmation: $("new-confirmation").value });
  if (!current(scope)) return;
  $("create-form").reset(); $("new-factory").open = false; await loadFactories(created.id);
  if (current(scope)) status("加工厂已开通。请设置允许厂方修改的项目，并把厂码提供给客户。");
}, { discard: true }); };
$("permissions-form").onsubmit = (event) => { event.preventDefault(); run(async () => {
  const scope = ticket(), target = selectedId, selected = plant();
  await api.call(`/factories/${target}`, "PATCH", { version: selected.version, name: $("edit-name").value,
    enabled: $("factory-enabled").checked, editable: [...$("permission-fields").querySelectorAll("input:checked")].map((node) => node.value),
    shareEditable: $("share-permission").checked });
  if (!current(scope) || target !== selectedId) return;
  await loadFactories(target); if (current(scope)) status("厂方资料和权限已保存。");
}, { discard: true }); };
$("rotate-code").onclick = () => {
  if (!identity || !api.check() || busy) return;
  if (!confirm("更换后，旧厂码不能用于新进入；已经进入的客户仍可使用。继续更换吗？")) return;
  run(async () => {
    const scope = ticket(), target = selectedId;
    await api.call(`/factories/${target}/rotate-code`, "POST");
    if (!current(scope) || target !== selectedId) return;
    await loadFactories(target); if (current(scope)) status("厂码已更换，请使用新厂码推广。");
  }, { discard: true });
};
$("reset-form").onsubmit = (event) => { event.preventDefault(); run(async () => {
  const scope = ticket();
  await api.call(`/factories/${selectedId}/password`, "POST", { password: $("reset-password").value, confirmation: $("reset-confirmation").value });
  if (current(scope)) { $("reset-form").reset(); status("厂方密码已重置，旧管理登录已退出。"); }
}); };
$("own-password-form").onsubmit = (event) => { event.preventDefault(); run(async () => {
  const scope = ticket();
  await api.call("/password", "POST", { currentPassword: $("current-password").value, password: $("own-new-password").value, confirmation: $("own-confirmation").value });
  if (current(scope)) await finishReset(api.reset(), "密码已修改，请重新登录。");
}, { discard: true }); };
$("refresh-contacts").onclick = () => run(loadContacts);
$("export-contacts").onclick = () => run(async () => {
  const scope = ticket(), target = selectedId;
  const data = await api.download(`/factories/${target}/contacts.csv`);
  if (!current(scope) || target !== selectedId) return;
  const url = URL.createObjectURL(data); downloadUrls.add(url);
  const link = element("a"); link.href = url; link.download = "厂方手机号.csv";
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); }, 1000);
  status("手机号名单已导出。");
});
window.addEventListener("beforeunload", (event) => { api.check(); if (dirty) { event.preventDefault(); event.returnValue = ""; } });
window.addEventListener("offline", () => {
  if (!identity || !api.check()) return;
  intent.invalidate(); previewBody = ""; $("publish-config").disabled = true;
  status("网络未连接，当前修改尚未发布。", true);
});
function resume() {
  if (!api.check()) { if (!api.ready) start(); return; }
  if (identity && !busy) run(async () => {
    const scope = ticket();
    await api.call("/factories");
    if (current(scope)) await loadContacts();
  });
}
window.addEventListener("pagehide", () => api.clear());
window.addEventListener("pageshow", (event) => { if (event.persisted) start(); });
window.addEventListener("focus", resume);
window.addEventListener("online", resume);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resume(); });
$("connect-retry").onclick = start;
start();
