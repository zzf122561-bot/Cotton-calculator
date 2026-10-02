import {
  PASSWORD_ALGORITHM,
  PASSWORD_CREDENTIAL_VERSION,
  PASSWORD_ITERATIONS,
  PASSWORD_KEY_BITS,
  decodeBase64,
  derivePbkdf2Sha256,
  encodeBase64,
  hasSupportedCredentialParameters,
  verifyAdminPassword,
  verifyPasswordCredential,
} from "./access-control.js";

export const AUTHORIZED_USERS_STORAGE_KEY = "cottoncal.machine.users.v1";
export const AUTHORIZED_USERS_INITIALIZED_KEY = "cottoncal.machine.users-initialized.v1";
export const AUTHORIZED_USERS_SCHEMA_VERSION = 1;

export const INITIAL_AUTHORIZED_USER = Object.freeze({
  schemaVersion: AUTHORIZED_USERS_SCHEMA_VERSION,
  id: "default-fyx",
  name: "FYX",
  enabled: true,
  algorithm: PASSWORD_ALGORITHM,
  credentialVersion: PASSWORD_CREDENTIAL_VERSION,
  iterations: PASSWORD_ITERATIONS,
  keyBits: PASSWORD_KEY_BITS,
  saltBase64: "foYkP12n8F9fy9caqcCr1A==",
  verifierBase64: "fRUZcevG9OSVaI6yjM2q01x7GWYqfB04qQadhEwyrew=",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sanitizeAuthorizedUser(candidate) {
  if (!isPlainObject(candidate)) return null;
  if (Object.keys(candidate).sort().join() !== "algorithm,credentialVersion,enabled,id,iterations,keyBits,name,saltBase64,schemaVersion,verifierBase64") return null;
  if (candidate.schemaVersion !== AUTHORIZED_USERS_SCHEMA_VERSION) return null;
  if (typeof candidate.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(candidate.id)) return null;
  if (typeof candidate.name !== "string" || candidate.name.trim().length < 1 || candidate.name.length > 40) return null;
  if (typeof candidate.enabled !== "boolean" || !hasSupportedCredentialParameters(candidate)) return null;
  const salt = decodeBase64(candidate.saltBase64);
  const verifier = decodeBase64(candidate.verifierBase64);
  if (!salt || salt.length < 8 || !verifier || verifier.length !== candidate.keyBits / 8) return null;
  return {
    schemaVersion: AUTHORIZED_USERS_SCHEMA_VERSION,
    id: candidate.id,
    name: candidate.name.trim(),
    enabled: candidate.enabled,
    algorithm: candidate.algorithm,
    credentialVersion: candidate.credentialVersion,
    iterations: candidate.iterations,
    keyBits: candidate.keyBits,
    saltBase64: candidate.saltBase64,
    verifierBase64: candidate.verifierBase64,
  };
}

function parseUsersEnvelope(serialized) {
  if (typeof serialized !== "string") return null;
  try {
    const parsed = JSON.parse(serialized);
    if (!isPlainObject(parsed) || Object.keys(parsed).sort().join() !== "schemaVersion,users") return null;
    if (parsed.schemaVersion !== AUTHORIZED_USERS_SCHEMA_VERSION || !Array.isArray(parsed.users)) return null;
    const users = parsed.users.map(sanitizeAuthorizedUser);
    if (users.some((user) => user === null)) return null;
    const ids = users.map((user) => user.id);
    if (new Set(ids).size !== ids.length) return null;
    return users;
  } catch {
    return null;
  }
}

function isInitializedMarker(serialized) {
  if (typeof serialized !== "string") return false;
  try {
    const parsed = JSON.parse(serialized);
    return isPlainObject(parsed)
      && Object.keys(parsed).sort().join() === "initialized,schemaVersion"
      && parsed.schemaVersion === AUTHORIZED_USERS_SCHEMA_VERSION
      && parsed.initialized === true;
  } catch {
    return false;
  }
}

export function serializeAuthorizedUsers(users) {
  return JSON.stringify({ schemaVersion: AUTHORIZED_USERS_SCHEMA_VERSION, users });
}

export function deserializeAuthorizedUsers(serialized) {
  return parseUsersEnvelope(serialized) ?? [];
}

export function initializeAuthorizedUsers(storage = globalThis.localStorage) {
  try {
    const serializedUsers = storage.getItem(AUTHORIZED_USERS_STORAGE_KEY);
    const users = parseUsersEnvelope(serializedUsers);
    const initialized = isInitializedMarker(storage.getItem(AUTHORIZED_USERS_INITIALIZED_KEY));
    if (initialized) return users ?? [];

    const initialUsers = users ?? (serializedUsers === null ? [{ ...INITIAL_AUTHORIZED_USER }] : []);
    storage.setItem(AUTHORIZED_USERS_STORAGE_KEY, serializeAuthorizedUsers(initialUsers));
    storage.setItem(AUTHORIZED_USERS_INITIALIZED_KEY, JSON.stringify({
      schemaVersion: AUTHORIZED_USERS_SCHEMA_VERSION,
      initialized: true,
    }));
    return initialUsers;
  } catch {
    return [{ ...INITIAL_AUTHORIZED_USER }];
  }
}

export function saveAuthorizedUsers(users, storage = globalThis.localStorage) {
  try {
    storage.setItem(AUTHORIZED_USERS_STORAGE_KEY, serializeAuthorizedUsers(users));
    return true;
  } catch {
    return false;
  }
}

export async function createPasswordCredential(
  password,
  {
    cryptoProvider = globalThis.crypto,
    iterations = PASSWORD_ITERATIONS,
    keyBits = PASSWORD_KEY_BITS,
  } = {},
) {
  if (typeof password !== "string" || password.length < 1) throw new TypeError("Password is required");
  const salt = new Uint8Array(16);
  cryptoProvider.getRandomValues(salt);
  const verifier = await derivePbkdf2Sha256(
    new TextEncoder().encode(password),
    salt,
    iterations,
    cryptoProvider,
    keyBits,
  );
  return {
    algorithm: PASSWORD_ALGORITHM,
    credentialVersion: PASSWORD_CREDENTIAL_VERSION,
    iterations,
    keyBits,
    saltBase64: encodeBase64(salt),
    verifierBase64: encodeBase64(verifier),
  };
}

export async function createAuthorizedUser(name, password, options = {}) {
  const normalizedName = String(name).trim();
  if (!normalizedName || normalizedName.length > 40) throw new TypeError("User name is required");
  return {
    schemaVersion: AUTHORIZED_USERS_SCHEMA_VERSION,
    id: options.id ?? createId(),
    name: normalizedName,
    enabled: true,
    ...await createPasswordCredential(password, options),
  };
}

export async function resetAuthorizedUserPassword(user, password, options = {}) {
  return { ...user, ...await createPasswordCredential(password, options) };
}

export async function authenticateAuthorizedUser(password, users, cryptoProvider = globalThis.crypto) {
  for (const user of users) {
    if (user.enabled && await verifyPasswordCredential(password, user, cryptoProvider)) {
      return { type: "user", id: user.id, name: user.name };
    }
  }
  return null;
}

export async function findPasswordConflict(
  password,
  users,
  {
    excludeUserId = null,
    verifyAdmin = verifyAdminPassword,
    cryptoProvider = globalThis.crypto,
  } = {},
) {
  if (await verifyAdmin(password, cryptoProvider)) return { type: "admin" };
  for (const user of users) {
    if (user.id !== excludeUserId && await verifyPasswordCredential(password, user, cryptoProvider)) {
      return { type: "user", userId: user.id, name: user.name };
    }
  }
  return null;
}

export class UserMutationGate {
  constructor() {
    this.userMutationPending = false;
  }

  async run(operation, onPendingChange = () => {}) {
    if (this.userMutationPending) return { entered: false };
    this.userMutationPending = true;
    onPendingChange(true);
    try {
      return { entered: true, value: await operation() };
    } finally {
      this.userMutationPending = false;
      onPendingChange(false);
    }
  }
}
