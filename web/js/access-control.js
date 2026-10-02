export const PASSWORD_ALGORITHM = "PBKDF2-HMAC-SHA256";
export const PASSWORD_CREDENTIAL_VERSION = 1;
export const PASSWORD_ITERATIONS = 210_000;
export const PASSWORD_KEY_BITS = 256;

export const ADMIN_VERIFIER_CONFIG = Object.freeze({
  algorithm: PASSWORD_ALGORITHM,
  credentialVersion: PASSWORD_CREDENTIAL_VERSION,
  iterations: PASSWORD_ITERATIONS,
  keyBits: PASSWORD_KEY_BITS,
  saltBase64: "MVhVUJ0OO5rsGgdhO18Cog==",
  verifierBase64: "XSoEK1e33FqI1213ciSRAdz55yYZBbSztuZMaj/1f4A=",
});

const REQUIRED_TAPS = 10;
const TAP_WINDOW_MS = 5_000;
const MAX_FAILURES = 5;
const COOLDOWN_MS = 30_000;

export function decodeBase64(value) {
  try {
    const binary = globalThis.atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function encodeBase64(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

export function constantTimeEqual(left, right) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function derivePbkdf2Sha256(
  passwordBytes,
  saltBytes,
  iterations,
  cryptoProvider = globalThis.crypto,
  keyBits = PASSWORD_KEY_BITS,
) {
  const key = await cryptoProvider.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await cryptoProvider.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    key,
    keyBits,
  );
  return new Uint8Array(bits);
}

export function hasSupportedCredentialParameters(credential) {
  return credential?.algorithm === PASSWORD_ALGORITHM
    && credential.credentialVersion === PASSWORD_CREDENTIAL_VERSION
    && Number.isInteger(credential.iterations)
    && credential.iterations > 0
    && credential.iterations <= 1_000_000
    && Number.isInteger(credential.keyBits)
    && credential.keyBits >= 128
    && credential.keyBits <= 512
    && credential.keyBits % 8 === 0
    && typeof credential.saltBase64 === "string"
    && typeof credential.verifierBase64 === "string";
}

export async function verifyPasswordCredential(password, credential, cryptoProvider = globalThis.crypto) {
  if (!hasSupportedCredentialParameters(credential)) return false;
  const salt = decodeBase64(credential.saltBase64);
  const expected = decodeBase64(credential.verifierBase64);
  if (!salt || salt.length < 8 || !expected || expected.length !== credential.keyBits / 8) return false;
  try {
    const passwordBytes = new TextEncoder().encode(password);
    const derived = await derivePbkdf2Sha256(
      passwordBytes,
      salt,
      credential.iterations,
      cryptoProvider,
      credential.keyBits,
    );
    return constantTimeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function verifyAdminPassword(password, cryptoProvider = globalThis.crypto) {
  return verifyPasswordCredential(password, ADMIN_VERIFIER_CONFIG, cryptoProvider);
}

export class TenTapTrigger {
  constructor(now = () => performance.now(), requiredTaps = REQUIRED_TAPS, windowMs = TAP_WINDOW_MS) {
    this.now = now;
    this.requiredTaps = requiredTaps;
    this.windowMs = windowMs;
    this.reset();
  }

  registerTap() {
    const current = this.now();
    if (this.firstTapAt === null || current - this.firstTapAt > this.windowMs) {
      this.firstTapAt = current;
      this.tapCount = 1;
      return this.requiredTaps === 1;
    }
    this.tapCount += 1;
    if (this.tapCount < this.requiredTaps) return false;
    this.reset();
    return true;
  }

  reset() {
    this.firstTapAt = null;
    this.tapCount = 0;
  }
}

export class AccessGate {
  constructor({ authenticate, verify, now = () => performance.now() } = {}) {
    this.authenticate = authenticate ?? (verify
      ? async (password) => (await verify(password) ? { type: "user", id: "injected" } : null)
      : async (password) => (await verifyAdminPassword(password) ? { type: "admin" } : null));
    this.now = now;
    this.trigger = new TenTapTrigger(now);
    this.failures = 0;
    this.cooldownUntil = 0;
    this.principal = null;
  }

  get unlocked() {
    return this.principal !== null;
  }

  registerTap() {
    return this.principal?.type !== "admin" && this.trigger.registerTap();
  }

  cooldownRemainingSeconds() {
    return Math.ceil(Math.max(0, this.cooldownUntil - this.now()) / 1_000);
  }

  async submit(password) {
    const remaining = this.cooldownRemainingSeconds();
    if (remaining > 0) return { status: "cooldown", secondsRemaining: remaining };

    const principal = await this.authenticate(password);
    if (principal?.type === "admin" || principal?.type === "user") {
      this.failures = 0;
      this.principal = principal;
      return { status: "unlocked", principal };
    }

    this.failures += 1;
    if (this.failures >= MAX_FAILURES) {
      this.failures = 0;
      this.cooldownUntil = this.now() + COOLDOWN_MS;
      return { status: "cooldown", secondsRemaining: this.cooldownRemainingSeconds() };
    }
    return { status: "incorrect", attemptsRemaining: MAX_FAILURES - this.failures };
  }

  lock() {
    this.principal = null;
    this.trigger.reset();
  }
}
