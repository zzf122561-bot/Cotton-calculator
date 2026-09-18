const TEN = 10n;

function abs(value) {
  return value < 0n ? -value : value;
}

function gcd(a, b) {
  let left = abs(a);
  let right = abs(b);
  while (right !== 0n) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left || 1n;
}

function pow10(scale) {
  return TEN ** BigInt(scale);
}

/** Exact rational arithmetic backed exclusively by BigInt. */
export class Decimal {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new RangeError("Denominator cannot be zero");
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = gcd(numerator, denominator);
    this.numerator = (numerator / divisor) * sign;
    this.denominator = abs(denominator / divisor);
    Object.freeze(this);
  }

  static parse(text) {
    if (typeof text !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
      throw new TypeError("Invalid decimal");
    }
    const negative = text.startsWith("-");
    const unsigned = text.replace(/^[+-]/, "");
    const [integerPart, fractionPart = ""] = unsigned.split(".");
    const digits = `${integerPart || "0"}${fractionPart}`;
    const numerator = BigInt(digits || "0") * (negative ? -1n : 1n);
    return new Decimal(numerator, pow10(fractionPart.length));
  }

  static integer(value) {
    return new Decimal(BigInt(value));
  }

  add(other) {
    return new Decimal(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  subtract(other) {
    return new Decimal(
      this.numerator * other.denominator - other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  multiply(other) {
    return new Decimal(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  divide(other) {
    if (other.numerator === 0n) throw new RangeError("Division by zero");
    return new Decimal(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  compare(other) {
    const difference = this.numerator * other.denominator - other.numerator * this.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  abs() {
    return new Decimal(abs(this.numerator), this.denominator);
  }
}

/** Returns an integer scaled by 10^scale using decimal HALF_UP rounding. */
export function roundHalfUp(value, scale) {
  const scaledNumerator = value.numerator * pow10(scale);
  const negative = scaledNumerator < 0n;
  const unsigned = abs(scaledNumerator);
  let quotient = unsigned / value.denominator;
  const remainder = unsigned % value.denominator;
  if (remainder * 2n >= value.denominator) quotient += 1n;
  return negative ? -quotient : quotient;
}

export function formatFixed(value, scale) {
  const scaled = roundHalfUp(value, scale);
  const negative = scaled < 0n;
  const digits = abs(scaled).toString().padStart(scale + 1, "0");
  const body = scale === 0
    ? digits
    : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  return `${negative ? "-" : ""}${body}`;
}

export function formatTrimmed(value, scale) {
  const fixed = formatFixed(value, scale);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

export function groupIntegerPart(text) {
  const [integer, fraction] = text.split(".");
  const negative = integer.startsWith("-");
  const digits = negative ? integer.slice(1) : integer;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}
