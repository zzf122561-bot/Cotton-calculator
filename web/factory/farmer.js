import { ComparisonSet, renderChart } from "./comparison.js";
import { TenTapTrigger } from "./access-control.js";
import { Api, $, element, button, status, readableTime, showShare, wireShare, compareSeed, seedDifference, priceSummary, LatestIntent } from "./shared.js";

const api = new Api();
const intent = new LatestIntent(), comparison = new ComparisonSet(), tapTrigger = new TenTapTrigger();
$("settings-trigger").onclick = () => { if (tapTrigger.registerTap()) window.location.assign("./manage.html"); };
let context = null, result = null, timer, revision = 0, anchor = "futures", foundCode = "";
let operationPending = false;
let reloadRequired = false;
const fields = { seedCottonPrice: $("seed-price"), futuresPrice: $("futures-price"), basisPrice: $("basis-price") };

function setActions() {
  for (const id of ["add-current", "share-current"]) $(id).disabled = !result || operationPending;
}
function resultHint(message = "", retry = false) {
  $("result-detail").textContent = message;
  $("result-detail").hidden = !message;
  $("retry-calculate").hidden = !retry;
}
function invalidate(message = "输入已变化，正在测算…") {
  intent.invalidate(); result = null; setActions();
  resultHint(message);
  $("lint-total").textContent = "—";
}
function publicInputs() {
  return { anchor, ...Object.fromEntries(Object.entries(fields).map(([key, node]) => [key, node.value.trim()])) };
}
async function calculateNow() {
  clearTimeout(timer);
  if (!context || !context.factory.enabled) return;
  const version = intent.version;
  const payload = { ...publicInputs(), generation: context.generation, revision: ++revision };
  const required = anchor === "seed" ? payload.seedCottonPrice : payload.futuresPrice;
  if (!required || !payload.basisPrice || payload.basisPrice === "-") {
    resultHint("请填写完整的价格和基差。");
    return;
  }
  try {
    const next = await api.call("/calculate", "POST", payload);
    if (!intent.isCurrent(version)) return;
    result = next;
    if (anchor === "seed") fields.futuresPrice.value = next.prices.futuresPrice;
    else fields.seedCottonPrice.value = next.prices.seedCottonPrice;
    $("lint-total").textContent = next.prices.lintPrice;
    resultHint();
    status(); setActions();
  } catch (error) {
    if (!intent.isCurrent(version)) return;
    result = null; setActions();
    resultHint(error.message, true);
    if (error.status === 409) {
      reloadRequired = true;
      $("retry-calculate").textContent = "重新载入并测算";
    }
    status(error.message, true);
  }
}
for (const [key, input] of Object.entries(fields)) {
  input.addEventListener("input", () => {
    anchor = key === "seedCottonPrice" ? "seed" : "futures";
    invalidate(); clearTimeout(timer); timer = setTimeout(calculateNow, 450);
  });
}
$("retry-calculate").onclick = () => {
  if (reloadRequired) run(loadWorkspace);
  else { invalidate(); calculateNow(); }
};

function planCard(plan, low, high) {
  const card = element("article", undefined, "record-card");
  card.append(element("h3", `方案 ${plan.number}${plan.note ? " · " + plan.note : ""}`), element("p", `${context.factory.name} · ${readableTime(plan.created)}`, "help"));
  card.append(priceSummary(plan));
  const labels = [];
  if (compareSeed(plan, low) === 0) labels.push("最低籽棉价");
  if (compareSeed(plan, high) === 0) labels.push("最高籽棉价");
  card.append(element("p", labels.join(" · ") || "籽棉价差", "badge"));
  card.append(element("p", `较最低方案，每公斤${compareSeed(plan, low) === 0 ? "相同" : "高 " + seedDifference(plan, low) + " 元"}`, "difference"));
  const actions = element("div", undefined, "actions");
  actions.append(button("移出对比", () => { comparison.remove(plan.id); renderComparison(); }));
  actions.append(button("按当前配置重算", () => {
    anchor = plan.inputs.anchor;
    for (const [key, node] of Object.entries(fields)) node.value = plan.inputs[key] || plan.prices[key];
    invalidate(); calculateNow(); $("calc-heading").scrollIntoView({ behavior: "auto", block: "start" });
  }));
  actions.append(button("分享此方案", () => showShare(plan.shareText)));
  card.append(actions);
  return card;
}
function renderComparison() {
  const items = comparison.items, ordered = [...items].sort(compareSeed);
  $("compare-count").textContent = `${items.length} / 4`;
  renderChart($("comparison-chart"), items);
  $("comparison").replaceChildren(...(items.length ? items.map(plan => planCard(plan, ordered[0], ordered.at(-1))) : [element("p", "把几次测算加入对比，价格连线和价差就会显示在这里。", "empty")]));
}
function addCurrent() {
  if (!result) throw new Error("请先完成一次有效测算。");
  comparison.add(result, $("plan-note").value);
  renderComparison();
  status("已加入本次对比。刷新或离开页面后清空。");
  $("comparison-panel").scrollIntoView({ behavior: "auto", block: "start" });
}
async function run(action) {
  if (operationPending) return;
  operationPending = true; setActions();
  try { await action(); } catch (error) { status(error.message, true); if (!context) $("connect-retry").hidden = false; }
  finally { operationPending = false; setActions(); }
}
$("add-current").onclick = () => run(addCurrent);
$("share-current").onclick = () => { if (result) showShare(result.shareText); };

function showEntry() {
  clearTimeout(timer); invalidate("请确认加工厂后继续。");
  $("workspace").hidden = true; $("entry").hidden = false;
  $("join-form").hidden = true;
  $("factory-code").value = ""; $("phone").value = ""; foundCode = "";
  status(); $("factory-code").focus();
}
$("factory-code").oninput = () => { $("join-form").hidden = true; foundCode = ""; };
$("code-form").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    const code = $("factory-code").value;
    const plant = await api.call("/code", "POST", { code });
    if ($("factory-code").value !== code) return;
    foundCode = code; $("found-name").textContent = plant.name;
    $("join-form").hidden = false; $("phone").focus(); status();
  });
};
$("join-form").onsubmit = (event) => {
  event.preventDefault();
  run(async () => {
    if (!foundCode || foundCode !== $("factory-code").value) throw new Error("请先查找并确认加工厂。");
    await api.call("/join", "POST", { code: foundCode, phone: $("phone").value });
    $("phone").value = "";
    await loadWorkspace();
  });
};
async function loadWorkspace() {
  invalidate();
  const previous = context, currentInputs = publicInputs();
  context = await api.call("/context");
  reloadRequired = false;
  $("retry-calculate").textContent = "重新测算";
  const sameFactory = previous?.factory.id === context.factory.id;
  if (!sameFactory || previous.generation !== context.generation) {
    $("plan-note").value = "";
    comparison.clear();
  }
  revision = context.revision;
  const inputs = sameFactory ? currentInputs : context.inputs;
  anchor = inputs.anchor;
  for (const [key, node] of Object.entries(fields)) node.value = inputs[key] || "";
  $("factory-name").textContent = context.factory.name;
  $("entry").hidden = true; $("workspace").hidden = false;
  for (const node of Object.values(fields)) node.disabled = !context.factory.enabled;
  renderComparison();
  if (context.factory.enabled) await calculateNow();
  else { resultHint(); status("该加工厂已停用，请联系本厂。", true); }
}
async function start() {
  const session = await api.call("/session");
  $("connect-retry").hidden = true;
  if (session.identity) await loadWorkspace();
  else showEntry();
}
window.addEventListener("offline", () => { clearTimeout(timer); invalidate(); resultHint("网络未连接，输入已保留。联网后请重新测算。", true); status("网络未连接，不能对比或分享未更新结果。", true); });
window.addEventListener("online", () => { if (context && !$("workspace").hidden) { invalidate(); calculateNow(); } });
window.addEventListener("focus", () => {
  if (context && !$("workspace").hidden && !$("share-dialog").open && !operationPending) { invalidate(); calculateNow(); }
});
window.addEventListener("pagehide", () => { comparison.clear(); });
window.addEventListener("resize", () => renderChart($("comparison-chart"), comparison.items));
window.addEventListener("pageshow", (event) => { if (event.persisted) { renderComparison(); invalidate(); run(start); } });
wireShare();
$("connect-retry").onclick = () => run(start);
run(start);
