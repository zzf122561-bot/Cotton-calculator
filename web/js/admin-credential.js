import {
  ADMIN_VERIFIER_CONFIG,
  PASSWORD_ALGORITHM,
  PASSWORD_CREDENTIAL_VERSION,
  PASSWORD_ITERATIONS,
  PASSWORD_KEY_BITS,
  decodeBase64,
  verifyPasswordCredential,
} from "./access-control.js";
import { createPasswordCredential, findPasswordConflict } from "./users.js";

export const ADMIN_CREDENTIAL_STORAGE_KEY = "cottoncal.machine.admin-credential.v1";
export const ADMIN_CREDENTIAL_SCHEMA_VERSION = 1;
export const ADMIN_PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MAX_LENGTH = 128;

const CREDENTIAL_KEYS = "algorithm,credentialVersion,iterations,keyBits,saltBase64,verifierBase64";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeAdminCredential(candidate) {
  if (!isPlainObject(candidate) || Object.keys(candidate).sort().join() !== CREDENTIAL_KEYS) return null;
  if (candidate.algorithm !== PASSWORD_ALGORITHM
    || candidate.credentialVersion !== PASSWORD_CREDENTIAL_VERSION
    || candidate.iterations !== PASSWORD_ITERATIONS
    || candidate.keyBits !== PASSWORD_KEY_BITS) return null;
  const salt = decodeBase64(candidate.saltBase64);
  const verifier = decodeBase64(candidate.verifierBase64);
  if (!salt || salt.length !== 16 || !verifier || verifier.length !== PASSWORD_KEY_BITS / 8) return null;
  return {
    algorithm: candidate.algorithm,
    credentialVersion: candidate.credentialVersion,
    iterations: candidate.iterations,
    keyBits: candidate.keyBits,
    saltBase64: candidate.saltBase64,
    verifierBase64: candidate.verifierBase64,
  };
}

export function serializeAdminCredential(credential) {
  const sanitized = sanitizeAdminCredential(credential);
  if (!sanitized) throw new TypeError("Unsupported admin credential");
  return JSON.stringify({ schemaVersion: ADMIN_CREDENTIAL_SCHEMA_VERSION, credential: sanitized });
}

export function loadAdminCredential(storage = globalThis.localStorage) {
  let serialized;
  try {
    serialized = storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY);
  } catch {
    return { status: "unavailable", credential: null, serialized: null };
  }
  if (serialized === null) return { status: "default", credential: ADMIN_VERIFIER_CONFIG, serialized: null };
  try {
    const envelope = JSON.parse(serialized);
    if (!isPlainObject(envelope)
      || Object.keys(envelope).sort().join() !== "credential,schemaVersion"
      || envelope.schemaVersion !== ADMIN_CREDENTIAL_SCHEMA_VERSION) {
      return { status: "invalid", credential: null, serialized };
    }
    const credential = sanitizeAdminCredential(envelope.credential);
    return { status: credential ? "stored" : "invalid", credential, serialized };
  } catch {
    return { status: "invalid", credential: null, serialized };
  }
}

export async function changeAdminPassword({
  currentPassword,
  newPassword,
  confirmation,
  users,
  storage = globalThis.localStorage,
  cryptoProvider = globalThis.crypto,
  expectedSerialized,
}) {
  if (typeof currentPassword !== "string" || !currentPassword) return { status: "missing-current" };
  if (typeof newPassword !== "string"
    || newPassword.length < ADMIN_PASSWORD_MIN_LENGTH
    || newPassword.length > ADMIN_PASSWORD_MAX_LENGTH) return { status: "invalid-length" };
  if (newPassword !== confirmation) return { status: "mismatch" };

  const previous = loadAdminCredential(storage);
  if (!previous.credential) return { status: "storage-unavailable" };
  if (expectedSerialized !== undefined && previous.serialized !== expectedSerialized) return { status: "changed-concurrently" };
  if (!await verifyPasswordCredential(currentPassword, previous.credential, cryptoProvider)) return { status: "incorrect-current" };
  if (await verifyPasswordCredential(newPassword, previous.credential, cryptoProvider)) return { status: "same-password" };

  const conflict = await findPasswordConflict(newPassword, users, {
    verifyAdmin: async () => false,
    cryptoProvider,
  });
  if (conflict) return { status: "user-conflict", userName: conflict.name };

  let serialized;
  let credential;
  try {
    credential = await createPasswordCredential(newPassword, { cryptoProvider });
    serialized = serializeAdminCredential(credential);
  } catch {
    return { status: "creation-failure" };
  }

  const latest = loadAdminCredential(storage);
  if (!latest.credential || latest.serialized !== previous.serialized) return { status: "changed-concurrently" };
  try {
    storage.setItem(ADMIN_CREDENTIAL_STORAGE_KEY, serialized);
    if (storage.getItem(ADMIN_CREDENTIAL_STORAGE_KEY) !== serialized) return { status: "storage-failure" };
  } catch {
    return { status: "storage-failure" };
  }
  return { status: "changed", credential, serialized };
}
