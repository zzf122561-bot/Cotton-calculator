import { Decimal, formatFixed } from "./decimal.js";
import { decimalFromStored } from "./records.js";

export const SHARE_TEMPLATE_STORAGE_KEY = "cottoncal.machine.share-template.v1";
export const SHARE_TEMPLATE_SCHEMA_VERSION = 1;
export const SHARE_DIVIDER = "————————————————";

export const DYNAMIC_MODULES = Object.freeze({
  date: "测算日期",
  lintPrice: "现货价格",
  seedCottonPrice: "籽棉单价",
  basis: "计算方向",
  lintPercentage: "衣分率",
  lossPercentage: "损耗率",
  cottonseedPrice: "棉籽价格",
  processingFee: "加工费",
  laborFee: "人工费",
  warehouseFee: "入库费",
  financeFee: "财务费",
  subsidy: "补贴（冲减）",
});

const requiredDynamicKeys = Object.keys(DYNAMIC_MODULES);

function createId(prefix = "block") {
  if (typeof globalThis.crypto?.randomUUID === "function") return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function createDefaultShareTemplate() {
  return {
    schemaVersion: SHARE_TEMPLATE_SCHEMA_VERSION,
    blocks: [
      { id: "title", type: "static", text: "【籽棉单价测算】", visible: true },
      { id: "date", type: "dynamic", key: "date", visible: true },
      { id: "lint-price", type: "dynamic", key: "lintPrice", visible: true },
      { id: "seed-price", type: "dynamic", key: "seedCottonPrice", visible: true },
      { id: "divider", type: "divider", visible: true },
      { id: "disclaimer", type: "static", text: "(数据仅供参考,以实际成交为准)", visible: true },
      { id: "company", type: "static", text: "---公司名（可改）---", visible: true },
      { id: "basis", type: "dynamic", key: "basis", visible: false },
      { id: "lint-percentage", type: "dynamic", key: "lintPercentage", visible: false },
      { id: "loss-percentage", type: "dynamic", key: "lossPercentage", visible: false },
      { id: "cottonseed-price", type: "dynamic", key: "cottonseedPrice", visible: false },
      { id: "processing-fee", type: "dynamic", key: "processingFee", visible: false },
      { id: "labor-fee", type: "dynamic", key: "laborFee", visible: false },
      { id: "warehouse-fee", type: "dynamic", key: "warehouseFee", visible: false },
      { id: "finance-fee", type: "dynamic", key: "financeFee", visible: false },
      { id: "subsidy", type: "dynamic", key: "subsidy", visible: false },
    ],
  };
}

function sanitizeBlock(candidate) {
  if (!isPlainObject(candidate) || typeof candidate.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(candidate.id)) return null;
  if (typeof candidate.visible !== "boolean") return null;
  if (candidate.type === "dynamic") {
    if (!requiredDynamicKeys.includes(candidate.key)) return null;
    if (Object.keys(candidate).sort().join() !== "id,key,type,visible") return null;
    return { id: candidate.id, type: "dynamic", key: candidate.key, visible: candidate.visible };
  }
  if (candidate.type === "static") {
    if (typeof candidate.text !== "string" || candidate.text.length > 200) return null;
    if (Object.keys(candidate).sort().join() !== "id,text,type,visible") return null;
    return { id: candidate.id, type: "static", text: candidate.text, visible: candidate.visible };
  }
  if (candidate.type === "divider") {
    if (Object.keys(candidate).sort().join() !== "id,type,visible") return null;
    return { id: candidate.id, type: "divider", visible: candidate.visible };
  }
  return null;
}

export function deserializeShareTemplate(serialized) {
  if (typeof serialized !== "string") return createDefaultShareTemplate();
  try {
    const parsed = JSON.parse(serialized);
    if (!isPlainObject(parsed) || Object.keys(parsed).sort().join() !== "blocks,schemaVersion") return createDefaultShareTemplate();
    if (parsed.schemaVersion !== SHARE_TEMPLATE_SCHEMA_VERSION || !Array.isArray(parsed.blocks) || parsed.blocks.length > 100) {
      return createDefaultShareTemplate();
    }
    const blocks = parsed.blocks.map(sanitizeBlock);
    if (blocks.some((block) => block === null)) return createDefaultShareTemplate();
    const ids = blocks.map((block) => block.id);
    if (new Set(ids).size !== ids.length) return createDefaultShareTemplate();
    const dynamicKeys = blocks.filter((block) => block.type === "dynamic").map((block) => block.key);
    if (new Set(dynamicKeys).size !== dynamicKeys.length) return createDefaultShareTemplate();
    if (!requiredDynamicKeys.every((key) => dynamicKeys.includes(key))) return createDefaultShareTemplate();
    return { schemaVersion: SHARE_TEMPLATE_SCHEMA_VERSION, blocks };
  } catch {
    return createDefaultShareTemplate();
  }
}

export function serializeShareTemplate(template) {
  return JSON.stringify(template);
}

export function loadShareTemplate(storage = globalThis.localStorage) {
  try {
    return deserializeShareTemplate(storage.getItem(SHARE_TEMPLATE_STORAGE_KEY));
  } catch {
    return createDefaultShareTemplate();
  }
}

export function saveShareTemplate(template, storage = globalThis.localStorage) {
  try {
    storage.setItem(SHARE_TEMPLATE_STORAGE_KEY, serializeShareTemplate(template));
    return true;
  } catch {
    return false;
  }
}

export function updateTemplateBlock(template, blockId, patch) {
  const blocks = template.blocks.map((block) => {
    if (block.id !== blockId) return block;
    if (block.type === "dynamic") return { ...block, visible: patch.visible ?? block.visible };
    if (block.type === "static") {
      return {
        ...block,
        visible: patch.visible ?? block.visible,
        text: typeof patch.text === "string" ? patch.text.slice(0, 200) : block.text,
      };
    }
    return { ...block, visible: patch.visible ?? block.visible };
  });
  return { ...template, blocks };
}

export function moveTemplateBlock(template, blockId, offset) {
  const blocks = [...template.blocks];
  const index = blocks.findIndex((block) => block.id === blockId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= blocks.length) return template;
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  return { ...template, blocks };
}

export function addStaticTemplateBlock(template, text = "新增文字") {
  return {
    ...template,
    blocks: [...template.blocks, { id: createId("static"), type: "static", text: String(text).slice(0, 200), visible: true }],
  };
}

export function addDividerTemplateBlock(template) {
  return {
    ...template,
    blocks: [...template.blocks, { id: createId("divider"), type: "divider", visible: true }],
  };
}

export function removeTemplateBlock(template, blockId) {
  const block = template.blocks.find((item) => item.id === blockId);
  if (!block || block.type === "dynamic") return template;
  return { ...template, blocks: template.blocks.filter((item) => item.id !== blockId) };
}

export function formatShareDate(savedAt) {
  const value = new Date(savedAt);
  const pad = (number) => String(number).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function renderDynamicModule(key, record) {
  const input = record.inputs;
  switch (key) {
    case "date": return `测算日期：${formatShareDate(record.savedAt)}`;
    case "lintPrice": return `现货价格：${record.displayResults.lintPrice}元/吨`;
    case "seedCottonPrice": {
      const exact = decimalFromStored(record.exactResults.seedCottonPrice);
      if (!exact) return "";
      const tonPrice = exact.multiply(Decimal.integer(1000));
      return `籽棉单价：${formatFixed(exact, 2)}元/公斤(≈${formatFixed(tonPrice, 0)}元/吨）`;
    }
    case "basis": return `计算方向：${record.basis === "seed" ? "籽棉价测算皮棉价" : "皮棉价反算籽棉价"}`;
    case "lintPercentage": return `衣分率：${input.lintPercentage}%`;
    case "lossPercentage": return `损耗率：${input.lossPercentage}%`;
    case "cottonseedPrice": return `棉籽价格：${input.cottonseedPrice}元/公斤`;
    case "processingFee": return `加工费：${input.processingFee}元/吨`;
    case "laborFee": return `人工费：${input.laborFee}元/吨`;
    case "warehouseFee": return `入库费：${input.warehouseFee}元/吨`;
    case "financeFee": return `财务费：${input.financeFee}元/吨`;
    case "subsidy": return `补贴（冲减）：${input.subsidy}元/吨`;
    default: return "";
  }
}

export function renderShareText(record, template = createDefaultShareTemplate()) {
  return template.blocks
    .filter((block) => block.visible)
    .map((block) => {
      if (block.type === "dynamic") return renderDynamicModule(block.key, record);
      if (block.type === "divider") return SHARE_DIVIDER;
      return block.text;
    })
    .filter((line) => line !== "")
    .join("\n");
}

export async function copyShareText(text, clipboard = globalThis.navigator?.clipboard) {
  if (typeof clipboard?.writeText !== "function") return { status: "unavailable" };
  try {
    await clipboard.writeText(text);
    return { status: "copied" };
  } catch {
    return { status: "error" };
  }
}

export async function invokeSystemShare(text, share = globalThis.navigator?.share) {
  if (typeof share !== "function") return { status: "unavailable" };
  try {
    await share({ title: "籽棉单价测算", text });
    return { status: "shared" };
  } catch (error) {
    return { status: error?.name === "AbortError" ? "cancelled" : "error" };
  }
}
