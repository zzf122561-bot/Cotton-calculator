export const LABELS = {
  seedCottonPrice: "籽棉价格", futuresPrice: "期货价格", basisPrice: "基差", lintPrice: "皮棉合计", date: "测算日期",
};
export const PARAMETERS = {
  lintPercentage: ["衣分率", "%"], lossPercentage: ["损耗率", "%"], cottonseedPrice: ["棉籽价格", "元/公斤"],
  processingFee: ["加工费", "元/吨"], laborFee: ["人工费", "元/吨"], warehouseFee: ["入库费", "元/吨"],
  financeFee: ["财务费", "元/吨"], subsidy: ["补贴（冲减）", "元/吨"], futuresPrice: ["默认期货价格", "元/吨"], basisPrice: ["默认基差", "元/吨"],
};

export class Api {
  constructor(management = false, fetcher = globalThis.fetch.bind(globalThis)) {
    this.prefix = "/v2/factory-api" + (management ? "/manage" : "");
    this.fetcher = fetcher;
    this.csrf = "";
  }
  async call(path, method = "GET", body) {
    let response;
    try {
      response = await this.fetcher(this.prefix + path, {
        method, credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: method === "GET" ? {} : { "Content-Type": "application/json", "X-CSRF-Token": this.csrf },
        ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
      });
    } catch { throw new Error("网络未连接，本次操作未完成。请联网后重试。"); }
    let result;
    try { result = await response.json(); } catch { throw new Error("服务暂不可用，请稍后重试。"); }
    if (!response.ok) {
      const error = new Error(result.detail || "操作未完成，请重试。");
      error.status = response.status;
      throw error;
    }
    if (result.csrf) this.csrf = result.csrf;
    return result;
  }
}

export const $ = (id) => document.getElementById(id);
export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function button(text, action, className = "secondary") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}
export function status(message = "", error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
export function readableTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString("zh-CN", { hour12: false });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); status("已复制报价文字，可以粘贴发送。"); }
  catch { status("无法直接复制，请选中下方文字后复制。", true); }
}
export function showShare(text) {
  $("share-text").value = text;
  $("share-dialog").showModal();
}
export function wireShare() {
  $("share-close").onclick = () => $("share-dialog").close();
  $("share-copy").onclick = () => copyText($("share-text").value);
  $("share-send").hidden = !navigator.share;
  $("share-send").onclick = async () => {
    try { await navigator.share({ text: $("share-text").value, title: "籽棉价格测算" }); }
    catch (error) { if (error.name !== "AbortError") status("分享未完成，可以复制文字后发送。", true); }
  };
}

// Exact comparison uses the server's rational seed result, not rounded labels.
export function compareSeed(a, b) {
  const delta = BigInt(a.exactSeed.n) * BigInt(b.exactSeed.d) - BigInt(b.exactSeed.n) * BigInt(a.exactSeed.d);
  return delta < 0n ? -1 : delta > 0n ? 1 : 0;
}
export function seedDifference(a, b) {
  const n = BigInt(a.exactSeed.n) * BigInt(b.exactSeed.d) - BigInt(b.exactSeed.n) * BigInt(a.exactSeed.d);
  const d = BigInt(a.exactSeed.d) * BigInt(b.exactSeed.d);
  const magnitude = n < 0n ? -n : n;
  const cents = (magnitude * 200n + d) / (2n * d);
  return `${n < 0n ? "-" : ""}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function priceSummary(plan) {
  const box = element("div", undefined, "summary-prices");
  for (const key of ["seedCottonPrice", "futuresPrice", "basisPrice", "lintPrice"]) {
    const row = element("div");
    row.append(element("span", LABELS[key]), element("strong", plan.prices[key]),
      element("span", key === "seedCottonPrice" ? "元/公斤" : "元/吨"));
    box.append(row);
  }
  return box;
}

// A latest-intent gate makes delayed responses incapable of re-enabling stale actions.
export class LatestIntent {
  constructor() { this.version = 0; }
  invalidate() { return ++this.version; }
  isCurrent(version) { return version === this.version; }
}
