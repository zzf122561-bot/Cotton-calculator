"""Factory calculator domain: exact fractions, private configuration, public snapshots."""
from copy import deepcopy
from fractions import Fraction
import re

from fastapi import HTTPException

PARAMETERS = {
    "lintPercentage": (4, "衣分率", "%"), "lossPercentage": (4, "损耗率", "%"),
    "cottonseedPrice": (6, "棉籽价格", "元/公斤"), "processingFee": (2, "加工费", "元/吨"),
    "laborFee": (2, "人工费", "元/吨"), "warehouseFee": (2, "入库费", "元/吨"),
    "financeFee": (2, "财务费", "元/吨"), "subsidy": (2, "补贴（冲减）", "元/吨"),
    "futuresPrice": (0, "默认期货价格", "元/吨"), "basisPrice": (0, "默认基差", "元/吨"),
}
DEFAULT_PARAMETERS = dict(lintPercentage="38", lossPercentage="13", cottonseedPrice="2.5",
                          processingFee="1000", laborFee="0", warehouseFee="0", financeFee="0",
                          subsidy="0", futuresPrice="16000", basisPrice="1000")
PUBLIC_FIELDS = {
    "date": ("测算日期", ""), "seedCottonPrice": ("籽棉价格", "元/公斤"),
    "futuresPrice": ("期货价格", "元/吨"), "basisPrice": ("基差", "元/吨"),
    "lintPrice": ("皮棉合计", "元/吨"),
}


def reject(message):
    raise HTTPException(422, message)


def number(value, scale=6, signed=False):
    if not isinstance(value, str) or len(value) > 24:
        reject("请输入有效数字")
    pattern = r"-?\d+(?:\.\d{1,%d})?" % scale if scale else r"-?\d+"
    if not re.fullmatch(pattern, value) or (value.startswith("-") and not signed):
        reject("数字格式或小数位不正确")
    result = Fraction(value)
    if abs(result) > 100_000_000:
        reject("数值超出范围")
    return result


def rounded(value, scale=0):
    """HALF_UP without Decimal context precision loss or binary floating point."""
    negative = value < 0
    scaled = abs(value) * 10 ** scale
    integer, remainder = divmod(scaled.numerator, scaled.denominator)
    if remainder * 2 >= scaled.denominator:
        integer += 1
    sign = "-" if negative and integer else ""
    if not scale:
        return sign + str(integer)
    whole, fraction = divmod(integer, 10 ** scale)
    return f"{sign}{whole}.{fraction:0{scale}d}"


def validate_parameters(parameters):
    if not isinstance(parameters, dict) or set(parameters) != set(PARAMETERS):
        reject("计算参数不完整")
    values = {key: number(parameters[key], spec[0], key == "basisPrice") for key, spec in PARAMETERS.items()}
    lint, loss = values["lintPercentage"], values["lossPercentage"]
    if not 0 < lint <= 100 or not 0 <= loss <= 100 or lint + loss > 100:
        reject("衣分率须大于 0，且衣分率与损耗率之和不能超过 100%")
    calculate(parameters, {"anchor": "futures", "futuresPrice": parameters["futuresPrice"],
                           "basisPrice": parameters["basisPrice"]})
    return deepcopy(parameters)


def calculate(parameters, inputs):
    anchor = inputs.get("anchor")
    if anchor not in {"seed", "futures"}:
        reject("请选择有效计算方向")
    basis = number(inputs.get("basisPrice"), 0, True)
    lint_ratio = Fraction(parameters["lintPercentage"]) / 100
    loss_ratio = Fraction(parameters["lossPercentage"]) / 100
    deduction = (1 - lint_ratio - loss_ratio) * Fraction(parameters["cottonseedPrice"])
    fees = sum(Fraction(parameters[key]) for key in ("processingFee", "laborFee", "warehouseFee", "financeFee")) - Fraction(parameters["subsidy"])
    if anchor == "seed":
        seed = number(inputs.get("seedCottonPrice"))
        lint = (seed - deduction) / lint_ratio * 1000 + fees
        futures = lint - basis
    else:
        futures = number(inputs.get("futuresPrice"), 0)
        lint = futures + basis
        seed = (lint - fees) / 1000 * lint_ratio + deduction
    if any(value < 0 or value > 100_000_000 for value in (seed, lint, futures)):
        reject("当前输入得到负价格或超出范围，请检查价格和基差")
    display = dict(seedCottonPrice=rounded(seed, 2), futuresPrice=rounded(futures),
                   basisPrice=rounded(basis), lintPrice=rounded(lint))
    # Keep exact seed for comparison; never include private parameters in this view.
    return dict(prices=display, exactSeed={"n": str(seed.numerator), "d": str(seed.denominator)})


def default_template():
    return [dict(id="title", type="text", text="【籽棉价格测算】", visible=True),
            *[dict(id=key, type="field", key=key, visible=True) for key in PUBLIC_FIELDS],
            dict(id="notice", type="text", text="数据仅供参考，以实际成交为准。\n如需了解相关服务，请联系本厂。", visible=True)]


def validate_template(template):
    if not isinstance(template, list) or not 1 <= len(template) <= 40:
        reject("分享模板需要 1 至 40 个内容块")
    ids, fields = set(), set()
    for block in template:
        if not isinstance(block, dict) or not isinstance(block.get("id"), str) or not re.fullmatch(r"[\w-]{1,64}", block["id"]):
            reject("分享内容格式不正确")
        if block["id"] in ids or type(block.get("visible")) is not bool:
            reject("分享内容重复或显示设置不正确")
        ids.add(block["id"])
        if block.get("type") == "text":
            if set(block) != {"id", "type", "text", "visible"} or not isinstance(block["text"], str) or len(block["text"]) > 500:
                reject("每段文字不能超过 500 字")
        elif block.get("type") == "field":
            if set(block) != {"id", "type", "key", "visible"} or block.get("key") not in PUBLIC_FIELDS or block["key"] in fields:
                reject("只能使用公开测算字段，且字段不能重复")
            fields.add(block["key"])
        else:
            reject("不支持的分享内容")
    if fields != set(PUBLIC_FIELDS):
        reject("公开测算字段须保留，可选择不显示")
    return deepcopy(template)


def render_share(template, result, date):
    lines = []
    for block in template:
        if not block["visible"]:
            continue
        if block["type"] == "text":
            lines.append(block["text"])
        else:
            key = block["key"]
            label, unit = PUBLIC_FIELDS[key]
            value = date if key == "date" else result["prices"][key]
            lines.append(f"{label}：{value}{(' ' + unit) if unit else ''}")
    return "\n".join(lines)
