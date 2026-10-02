import test from "node:test";
import assert from "node:assert/strict";
import { Decimal } from "../js/decimal.js";
import { createDefaultState } from "../js/calculator.js";
import { createRecordSnapshot, decimalToStored } from "../js/records.js";
import {
  SHARE_DIVIDER,
  addDividerTemplateBlock,
  addStaticTemplateBlock,
  copyShareText,
  createDefaultShareTemplate,
  deserializeShareTemplate,
  invokeSystemShare,
  moveTemplateBlock,
  removeTemplateBlock,
  renderShareText,
  serializeShareTemplate,
  updateTemplateBlock,
} from "../js/sharing.js";

function exactExampleRecord() {
  const record = createRecordSnapshot(createDefaultState(), { id: "share-1", savedAt: "2026-09-21T08:30:00" });
  return {
    ...record,
    exactResults: {
      seedCottonPrice: decimalToStored(new Decimal(873n, 125n)),
      lintPrice: decimalToStored(Decimal.integer(17000)),
    },
    displayResults: { seedCottonPrice: "6.98", lintPrice: "17000" },
  };
}

test("默认分享文本严格使用快照日期、现货价与精确籽棉吨价", () => {
  const text = renderShareText(exactExampleRecord());
  assert.equal(text, [
    "【籽棉单价测算】",
    "测算日期：2026-09-21",
    "现货价格：17000元/吨",
    "籽棉单价：6.98元/公斤(≈6984元/吨）",
    SHARE_DIVIDER,
    "(数据仅供参考,以实际成交为准)",
    "---公司名（可改）---",
  ].join("\n"));
});

test("全部机采棉动态模块可显隐，数值来自快照", () => {
  let template = createDefaultShareTemplate();
  for (const block of template.blocks.filter((item) => item.type === "dynamic")) {
    template = updateTemplateBlock(template, block.id, { visible: true });
  }
  const text = renderShareText(exactExampleRecord(), template);
  for (const label of ["计算方向", "衣分率", "损耗率", "棉籽价格", "加工费", "人工费", "入库费", "财务费", "补贴（冲减）"]) {
    assert.match(text, new RegExp(`${label}：`));
  }
});

test("分享模板支持静态文字和分隔线增删改、显隐与排序", () => {
  let template = createDefaultShareTemplate();
  template = addStaticTemplateBlock(template, "采购部");
  const staticBlock = template.blocks.at(-1);
  template = updateTemplateBlock(template, staticBlock.id, { text: "采购一部", visible: false });
  assert.equal(template.blocks.at(-1).text, "采购一部");
  assert.equal(template.blocks.at(-1).visible, false);
  template = moveTemplateBlock(template, staticBlock.id, -1);
  assert.equal(template.blocks.at(-2).id, staticBlock.id);
  template = removeTemplateBlock(template, staticBlock.id);
  assert.equal(template.blocks.some((block) => block.id === staticBlock.id), false);
  template = addDividerTemplateBlock(template);
  assert.equal(template.blocks.at(-1).type, "divider");
  const dynamic = template.blocks.find((block) => block.type === "dynamic");
  assert.equal(removeTemplateBlock(template, dynamic.id), template);
});

test("模板 schema 严格恢复，损坏或缺少动态模块回退默认值", () => {
  const template = createDefaultShareTemplate();
  assert.deepEqual(deserializeShareTemplate(serializeShareTemplate(template)), template);
  assert.equal(deserializeShareTemplate("{broken").blocks[0].id, "title");
  const missing = { ...template, blocks: template.blocks.filter((block) => block.key !== "subsidy") };
  assert.equal(deserializeShareTemplate(JSON.stringify(missing)).blocks.some((block) => block.key === "subsidy"), true);
});

test("复制和系统分享不可用、取消或抛错时返回明确状态", async () => {
  assert.deepEqual(await copyShareText("x", null), { status: "unavailable" });
  assert.deepEqual(await copyShareText("x", { writeText: async () => { throw new Error("denied"); } }), { status: "error" });
  assert.deepEqual(await copyShareText("x", { writeText: async () => {} }), { status: "copied" });
  assert.deepEqual(await invokeSystemShare("x", null), { status: "unavailable" });
  assert.deepEqual(await invokeSystemShare("x", async () => { throw new DOMException("cancel", "AbortError"); }), { status: "cancelled" });
  assert.deepEqual(await invokeSystemShare("x", async () => { throw new Error("failed"); }), { status: "error" });
  assert.deepEqual(await invokeSystemShare("x", async () => {}), { status: "shared" });
});
