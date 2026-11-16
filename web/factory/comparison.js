import { compareSeed, seedDifference, element } from "./shared.js";

// Page-memory snapshots only: no storage, network writes or customer identifiers.
export class ComparisonSet {
  constructor() { this.items = []; this.sequence = 0; }
  add(result, note = "") {
    if (this.items.some(item => item.id === result.id)) throw new Error("这次测算已在对比中，请修改价格后再加入。");
    if (this.items.length >= 4) throw new Error("最多比较 4 个方案，请先移出一个方案。");
    const snapshot = structuredClone(result);
    snapshot.number = ++this.sequence;
    snapshot.note = note.trim();
    this.items.push(snapshot);
  }
  remove(id) { this.items = this.items.filter(item => item.id !== id); }
  clear() { this.items = []; this.sequence = 0; }
}

export function chartModel(items) {
  if (!items.length) return null;
  const ordered = [...items].sort(compareSeed), low = ordered[0], high = ordered.at(-1);
  const values = items.map(item => Number(item.exactSeed.n) / Number(item.exactSeed.d));
  const minimum = Math.min(...values), maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, 0.02), floor = minimum - span * 0.3, range = span * 1.6;
  return { low, high, difference: seedDifference(high, low), points: items.map((item, index) => ({
    item, x: items.length === 1 ? 200 : 54 + index * 292 / (items.length - 1),
    y: 202 - (values[index] - floor) / range * 150,
  })) };
}

export function renderChart(container, items) {
  container.replaceChildren();
  const model = chartModel(items);
  if (!model) { container.hidden = true; return; }
  container.hidden = false;
  const headline = element("p", undefined, "chart-difference");
  headline.append(document.createTextNode(items.length > 1 ? "最高与最低，每公斤相差 " : "已加入 1 个方案，再加一个就能比价"));
  if (items.length > 1) headline.append(element("strong", model.difference), document.createTextNode(" 元"));
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  // Use the actual plot width so narrow screens do not shrink text below readable size.
  const width = Math.max(220, Math.min(600, container.clientWidth - 24));
  const x = point => 30 + (point.x - 54) / 292 * (width - 60);
  const graphic = svg("svg", { viewBox: `0 0 ${width} 250`, role: "img", "aria-label": `籽棉价格对比，单位元每公斤。${items.map(item => `方案${item.number}：${item.prices.seedCottonPrice}`).join("；")}` });
  for (const y of [62, 132, 202]) graphic.append(svg("line", { x1: 8, x2: width - 8, y1: y, y2: y, class: "chart-grid" }));
  graphic.append(svg("polyline", { points: model.points.map(point => `${x(point)},${point.y}`).join(" "), class: "chart-line" }));
  for (const point of model.points) {
    graphic.append(svg("circle", { cx: x(point), cy: point.y, r: 6, class: "chart-point" }));
    graphic.append(svg("text", { x: x(point), y: point.y - 17, "text-anchor": "middle", class: "chart-price" }, point.item.prices.seedCottonPrice));
    graphic.append(svg("text", { x: x(point), y: 237, "text-anchor": "middle", class: "chart-label" }, `方案${point.item.number}`));
  }
  const marketList = element("div", undefined, "chart-market-list");
  marketList.setAttribute("aria-label", "各方案期货价格与基差");
  for (const item of items) {
    const marketItem = element("section", undefined, "chart-market-item");
    marketItem.append(element("h3", `方案 ${item.number}`));
    for (const [key, label] of [["futuresPrice", "期货"], ["basisPrice", "基差"]]) {
      const row = element("p");
      row.append(element("span", label), element("strong", item.prices[key]), element("span", "元/吨"));
      marketItem.append(row);
    }
    marketList.append(marketItem);
  }
  container.append(headline, element("p", "籽棉价格 · 元/公斤", "chart-unit"), graphic, marketList,
    element("p", "按加入顺序连线，纵轴随价格范围缩放。比较的是方案价格，不是行情预测。", "help"));
}
