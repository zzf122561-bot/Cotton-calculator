export function buildInquirySummary({ presetName, state, formatted }) {
  const basisName = state.basis === "seed" ? "籽棉价" : "皮棉价";
  return [
    "皮棉采购测算摘要",
    `棉种：${presetName}`,
    `计算依据：${basisName}`,
    `籽棉价：${state.seedCottonPrice || "—"} 元/kg`,
    `皮棉入库成本：${formatted?.lintPrice ?? "—"} 元/吨`,
    `衣分率：${state.lintPercentage || "—"}%`,
    `损耗率：${state.lossPercentage || "—"}%`,
    `棉籽价格：${state.cottonseedPrice || "—"} 元/kg`,
    "",
    "想就采购数量、质量指标、交货地和账期进一步沟通。",
  ].join("\n");
}

export function inquiryMailto(summary, presetName) {
  const subject = encodeURIComponent(`皮棉采购询价 - ${presetName}`);
  const body = encodeURIComponent(summary);
  return `mailto:zzf8640283@126.com?subject=${subject}&body=${body}`;
}
