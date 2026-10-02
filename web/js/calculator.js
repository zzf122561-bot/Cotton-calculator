import { Decimal, formatFixed } from "./decimal.js";

export const FIELDS = Object.freeze({
  seedCottonPrice: { scale: 6, label: "籽棉价" },
  lintPrice: { scale: 0, label: "皮棉价" },
  lintPercentage: { scale: 4, label: "衣分率" },
  lossPercentage: { scale: 4, label: "损耗率" },
  cottonseedPrice: { scale: 6, label: "棉籽价格" },
  processingFee: { scale: 2, label: "加工费" },
  laborFee: { scale: 2, label: "人工费" },
  warehouseFee: { scale: 2, label: "入库费" },
  financeFee: { scale: 2, label: "财务费" },
  subsidy: { scale: 2, label: "补贴（冲减）" },
});

const ZERO = Decimal.integer(0);
const ONE = Decimal.integer(1);
const HUNDRED = Decimal.integer(100);
const THOUSAND = Decimal.integer(1000);

export const MACHINE_DEFAULTS = Object.freeze({
  seedCottonPrice: "7.3",
  lintPrice: "",
  lintPercentage: "38",
  lossPercentage: "13",
  cottonseedPrice: "2.5",
  processingFee: "1000",
  laborFee: "0",
  warehouseFee: "0",
  financeFee: "0",
  subsidy: "0",
  basis: "seed",
});

export function isAllowedInput(value, scale) {
  const pattern = scale === 0 ? /^\d*$/ : /^\d*(?:\.\d*)?$/;
  if (!pattern.test(value)) return false;
  return (value.split(".")[1]?.length ?? 0) <= scale;
}

function error(field, message) {
  return { field, message };
}

export function calculate(values, basis) {
  const lintRatio = values.lintPercentage.divide(HUNDRED);
  const lossRatio = values.lossPercentage.divide(HUNDRED);
  const errors = [];

  if (values.lintPercentage.compare(ZERO) <= 0 || values.lintPercentage.compare(HUNDRED) > 0) {
    errors.push(error("lintPercentage", "衣分率必须大于0且不超过100%"));
  }
  if (values.lossPercentage.compare(ZERO) < 0 || values.lossPercentage.compare(HUNDRED) > 0) {
    errors.push(error("lossPercentage", "损耗率必须在0%到100%之间"));
  }
  if (values.lintPercentage.add(values.lossPercentage).compare(HUNDRED) > 0) {
    errors.push(error("lossPercentage", "衣分率与损耗率之和不能超过100%"));
  }

  for (const field of ["cottonseedPrice", "processingFee", "laborFee", "warehouseFee", "financeFee", "subsidy"]) {
    if (values[field].compare(ZERO) < 0) errors.push(error(field, "金额不能小于0"));
  }
  if (basis === "seed" && values.seedCottonPrice.compare(ZERO) < 0) {
    errors.push(error("seedCottonPrice", "籽棉价不能小于0"));
  }
  if (basis === "lint" && values.lintPrice.compare(ZERO) < 0) {
    errors.push(error("lintPrice", "皮棉价不能小于0"));
  }
  if (errors.length) return { ok: false, errors };

  const cottonseedYield = ONE.subtract(lintRatio).subtract(lossRatio);
  const cottonseedDeductionPerKg = cottonseedYield.multiply(values.cottonseedPrice);
  const netFeesPerTon = values.processingFee
    .add(values.laborFee)
    .add(values.warehouseFee)
    .add(values.financeFee)
    .subtract(values.subsidy);

  if (basis === "seed") {
    const netSeedCostPerKg = values.seedCottonPrice.subtract(cottonseedDeductionPerKg);
    const rawLintCostPerTon = netSeedCostPerKg.divide(lintRatio).multiply(THOUSAND);
    const lintPrice = rawLintCostPerTon.add(netFeesPerTon);
    if (lintPrice.compare(ZERO) < 0) {
      return { ok: false, errors: [error("subsidy", "费用和补贴使皮棉成本低于0，请检查参数")] };
    }
    return {
      ok: true,
      result: { ...values, lintPrice, cottonseedYield, cottonseedDeductionPerKg, netSeedCostPerKg, rawLintCostPerTon, netFeesPerTon },
    };
  }

  const rawLintCostPerTon = values.lintPrice.subtract(netFeesPerTon);
  const netSeedCostPerKg = rawLintCostPerTon.divide(THOUSAND).multiply(lintRatio);
  const seedCottonPrice = netSeedCostPerKg.add(cottonseedDeductionPerKg);
  if (seedCottonPrice.compare(ZERO) < 0) {
    return { ok: false, errors: [error("lintPrice", "目标皮棉价过低，反算出的籽棉价小于0")] };
  }
  return {
    ok: true,
    result: { ...values, seedCottonPrice, cottonseedYield, cottonseedDeductionPerKg, netSeedCostPerKg, rawLintCostPerTon, netFeesPerTon },
  };
}

export function recalculate(state) {
  const errors = [];
  const values = {};
  for (const field of Object.keys(FIELDS)) {
    const isInactivePrice = (field === "seedCottonPrice" && state.basis === "lint")
      || (field === "lintPrice" && state.basis === "seed");
    try {
      values[field] = Decimal.parse(state[field]);
    } catch {
      values[field] = ZERO;
      if (!isInactivePrice) errors.push(error(field, "请输入有效数字"));
    }
  }
  if (errors.length) return { ...state, result: null, errors };

  const outcome = calculate(values, state.basis);
  if (!outcome.ok) return { ...state, result: null, errors: outcome.errors };
  return state.basis === "seed"
    ? { ...state, lintPrice: formatFixed(outcome.result.lintPrice, 0), result: outcome.result, errors: [] }
    : { ...state, seedCottonPrice: formatFixed(outcome.result.seedCottonPrice, 2), result: outcome.result, errors: [] };
}

export function createDefaultState() {
  return recalculate({ ...MACHINE_DEFAULTS });
}

export function editState(state, field, rawValue) {
  const value = rawValue.trim().replaceAll(",", "");
  const spec = FIELDS[field];
  if (!spec || !isAllowedInput(value, spec.scale) || state[field] === value) return state;
  const basis = field === "seedCottonPrice" ? "seed" : field === "lintPrice" ? "lint" : state.basis;
  return recalculate({ ...state, [field]: value, basis });
}
