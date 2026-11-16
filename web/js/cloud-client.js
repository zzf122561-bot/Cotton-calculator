export class CloudError extends Error {
  constructor(message, status = 0, seconds = 0) { super(message); this.status = status; this.seconds = seconds; }
}

export class CloudClient {
  constructor(fetcher = globalThis.fetch.bind(globalThis), sessionStore = globalThis.sessionStorage) {
    this.fetcher = fetcher;
    this.sessionStore = sessionStore;
    this.clear();
  }
  clear() { this.csrf = ""; this.elevation = ""; this.role = null; this.user = null; }
  lock() { this.elevation = ""; this.role = null; }
  async request(path, method = "GET", body) {
    let response;
    try {
      response = await this.fetcher(`/v2/api${path}`, {
        method, credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { ...(method !== "GET" ? { "Content-Type": "application/json", "X-CSRF-Token": this.csrf } : {}),
          ...(this.elevation ? { "X-Machine-Elevation": this.elevation } : {}) },
        ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
    } catch {
      throw new CloudError("无法连接服务器，请联网后重试；本次未保存。");
    }
    let data;
    try { data = await response.json(); } catch { throw new CloudError("服务器响应不可用，请稍后重试。", response.status); }
    if (!response.ok) {
      if (response.status === 403 || (response.status === 401 && data.detail !== "密码不正确")) this.lock();
      throw new CloudError(typeof data.detail === "string" ? data.detail : "请求失败，本次未保存。",
        response.status, Number(response.headers.get("Retry-After")) || 0);
    }
    return data;
  }
  async initialize() {
    const session = await this.request("/session");
    this.csrf = session.csrf;
    this.user = session.user;
    this.lock();
    let pending = false;
    try { pending = this.sessionStore?.getItem("cottoncal.machine.logout-pending") === "1"; } catch { /* Memory-only fallback. */ }
    if (pending) { await this.logout(); return this.initialize(); }
    return session;
  }
  async login(userId, password) {
    const session = await this.request("/login", "POST", { userId, password });
    this.csrf = session.csrf; this.user = session.user; this.lock();
    return session.user;
  }
  async unlock(password) {
    const result = await this.request("/unlock", "POST", { password });
    this.elevation = result.elevation; this.role = result.role;
    return result.role;
  }
  async logout() {
    try { this.sessionStore?.setItem("cottoncal.machine.logout-pending", "1"); } catch { /* No credential is persisted. */ }
    try {
      await this.request("/logout", "POST", {});
      try { this.sessionStore?.removeItem("cottoncal.machine.logout-pending"); } catch { /* Harmless repeat logout. */ }
    } finally { this.clear(); }
  }
}

export class OperationGate {
  constructor() { this.userMutationPending = false; }
  async run(operation, onPendingChange = () => {}) {
    if (this.userMutationPending) return { entered: false };
    this.userMutationPending = true; onPendingChange(true);
    try { return { entered: true, value: await operation() }; }
    finally { this.userMutationPending = false; onPendingChange(false); }
  }
}

export const CLOUD_MIGRATION_KEY = "cottoncal.machine.migration.machine-cloud-20261003";
const RESET_KEYS = ["cottoncal.machine.v1", "cottoncal.machine.users.v1", "cottoncal.machine.users-initialized.v1",
  "cottoncal.machine.admin-credential.v1", "cottoncal.machine.share-template.v1"];
export function migrateCloudStorage(storage = globalThis.localStorage) {
  try {
    if (storage.getItem(CLOUD_MIGRATION_KEY) === "complete") return true;
    for (const key of RESET_KEYS) storage.removeItem(key);
    storage.setItem(CLOUD_MIGRATION_KEY, "complete");
    return true;
  } catch { return false; }
}
