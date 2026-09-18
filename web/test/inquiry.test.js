import test from "node:test";
import assert from "node:assert/strict";
import { buildInquirySummary, inquiryMailto } from "../js/inquiry.js";

test("采购询价摘要包含当前测算和后续沟通要素", () => {
  const summary = buildInquirySummary({
    presetName: "手摘棉",
    state: {
      basis: "seed", seedCottonPrice: "6.8", lintPercentage: "40.6", lossPercentage: "2.5", cottonseedPrice: "2.24",
    },
    formatted: { lintPrice: "14,401" },
  });
  assert.match(summary, /手摘棉/);
  assert.match(summary, /籽棉价：6\.8 元\/kg/);
  assert.match(summary, /皮棉入库成本：14,401 元\/吨/);
  assert.match(summary, /采购数量、质量指标、交货地和账期/);
  assert.match(inquiryMailto(summary, "手摘棉"), /^mailto:zzf8640283@126\.com\?/);
});
