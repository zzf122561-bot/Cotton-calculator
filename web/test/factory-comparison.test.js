import test from "node:test";
import assert from "node:assert/strict";
import { ComparisonSet, chartModel, renderChart } from "../factory/comparison.js";

const result = (id, n = "730", d = "100") => ({ id, exactSeed: { n, d }, prices: { seedCottonPrice: (Number(n) / Number(d)).toFixed(2) }, shareText: "original" });
test("temporary comparison limits four distinct snapshots and allows removal", () => {
  const group = new ComparisonSet();
  for (let i = 1; i <= 4; i++) group.add(result(String(i)));
  assert.throws(() => group.add(result("5")), /最多比较 4/);
  assert.throws(() => group.add(result("1")), /已在对比/);
  group.remove("2"); group.add(result("5"));
  assert.deepEqual(group.items.map(item => item.number), [1, 3, 4, 5]);
});
test("temporary snapshots retain original prices and share text without persistence", () => {
  const group = new ComparisonSet(), input = result("1");
  group.add(input, " first ");
  input.prices.seedCottonPrice = "9.99"; input.shareText = "changed";
  assert.equal(group.items[0].prices.seedCottonPrice, "7.30");
  assert.equal(group.items[0].shareText, "original");
  assert.equal(group.items[0].note, "first");
  assert.equal(new ComparisonSet().items.length, 0);
  group.clear(); assert.equal(group.items.length, 0);
});
test("price line preserves entry order and matches exact extrema and difference", () => {
  const values = [result("a", "750"), result("b", "730"), result("c", "740")];
  const model = chartModel(values);
  assert.deepEqual(model.points.map(point => point.item.id), ["a", "b", "c"]);
  assert.equal(model.low.id, "b"); assert.equal(model.high.id, "a"); assert.equal(model.difference, "0.20");
  assert.ok(model.points[0].y < model.points[2].y && model.points[2].y < model.points[1].y);
});
test("price line stays finite for empty single equal and near-rounded prices", () => {
  assert.equal(chartModel([]), null);
  const single = chartModel([result("a")]);
  assert.equal(single.points[0].x, 200); assert.ok(Number.isFinite(single.points[0].y));
  const equal = chartModel([result("a"), result("b")]);
  assert.equal(equal.points[0].y, equal.points[1].y); assert.equal(equal.difference, "0.00");
  const near = chartModel([result("a", "73001", "10000"), result("b", "73002", "10000")]);
  assert.equal(near.low.id, "a"); assert.equal(near.high.id, "b"); assert.equal(near.difference, "0.00");
});

test("chart renders snapshot futures and signed basis with each scheme and units", (t) => {
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.className = ""; this.attributes = {}; this.clientWidth = 300; this.text = ""; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return this.text + this.children.map(node => node.textContent).join(""); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement: tag => new Node(tag), createElementNS: (_, tag) => new Node(tag),
    createTextNode: text => { const node = new Node("#text"); node.textContent = text; return node; },
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  const find = (node, predicate) => [node, ...node.children.flatMap(child => find(child, predicate))].filter(predicate);
  const group = new ComparisonSet(), input = result("first");
  Object.assign(input.prices, { futuresPrice: "16000", basisPrice: "-500" });
  group.add(input);
  input.prices.futuresPrice = "99999"; input.prices.basisPrice = "1000";
  group.add({ ...result("second", "750"), prices: { seedCottonPrice: "7.50", futuresPrice: "17000", basisPrice: "0" } });
  const container = new Node("div");
  renderChart(container, group.items);
  const markets = find(container, node => node.className === "chart-market-item");
  assert.equal(markets.length, 2);
  assert.deepEqual(markets.map(item => item.children.map(child => child.textContent)), [
    ["方案 1", "期货16000元/吨", "基差-500元/吨"],
    ["方案 2", "期货17000元/吨", "基差0元/吨"],
  ]);
  assert.deepEqual(find(container, node => node.attributes.class === "chart-price").map(node => node.textContent), ["7.30", "7.50"]);
  assert.equal(find(container, node => node.attributes.class === "chart-line").length, 1);
  group.remove("first"); renderChart(container, group.items);
  assert.deepEqual(find(container, node => node.className === "chart-market-item").map(node => node.textContent), ["方案 2期货17000元/吨基差0元/吨"]);
  group.clear(); renderChart(container, group.items);
  assert.equal(container.hidden, true); assert.equal(container.children.length, 0);
});
