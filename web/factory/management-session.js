// Management authority belongs to this document only. Never persist page proof.
export class SessionEndedError extends Error {
  constructor() { super("登录状态已失效，请重新登录。"); this.name = "SessionEndedError"; this.silent = true; }
}

export class ManagementSession {
  #fetch; #onEnd; #wall; #mono; #schedule; #cancel;
  #epoch = 0; #csrf = ""; #proof = ""; #ready = false;
  #wallEnd = 0; #monoEnd = 0; #timer; #pending = new Set();
  constructor({ fetcher = globalThis.fetch.bind(globalThis), onEnd = () => {}, clock = Date.now,
    monotonic = () => performance.now(), schedule = (action, delay) => setTimeout(action, delay), cancel = timer => clearTimeout(timer) } = {}) {
    this.prefix = "/v2/factory-api/manage";
    this.#fetch = fetcher; this.#onEnd = onEnd; this.#wall = clock; this.#mono = monotonic;
    this.#schedule = schedule; this.#cancel = cancel;
  }
  get epoch() { return this.#epoch; }
  get ready() { this.check(); return this.#ready; }
  get active() { return this.check(); }
  clear(message = "请重新登录后台。") {
    this.#epoch++;
    this.#proof = ""; this.#csrf = ""; this.#ready = false;
    this.#wallEnd = 0; this.#monoEnd = 0;
    this.#cancel(this.#timer); this.#timer = undefined;
    for (const controller of this.#pending) controller.abort();
    this.#pending.clear();
    this.#onEnd(message);
  }
  check() {
    if (!this.#proof) return false;
    if (this.#wall() >= this.#wallEnd || this.#mono() >= this.#monoEnd) {
      this.clear("登录已满一小时，请重新登录。");
      return false;
    }
    return true;
  }
  #arm() {
    this.#cancel(this.#timer);
    const remaining = Math.min(this.#wallEnd - this.#wall(), this.#monoEnd - this.#mono());
    this.#timer = this.#schedule(() => { if (this.check()) this.#arm(); }, Math.max(1, remaining));
  }
  #assertCurrent(epoch, protectedRequest) {
    if (epoch !== this.#epoch || (protectedRequest && !this.check())) throw new SessionEndedError();
  }
  async #request(path, method, body, { protectedRequest = false, blob = false } = {}) {
    if (protectedRequest && !this.check()) throw new SessionEndedError();
    const epoch = this.#epoch, controller = new AbortController();
    const headers = method === "GET" ? {} : { "Content-Type": "application/json", "X-CSRF-Token": this.#csrf };
    if (protectedRequest) headers["X-Page-Proof"] = this.#proof;
    this.#pending.add(controller);
    try {
      let response;
      try {
        response = await this.#fetch(this.prefix + path, {
          method, credentials: "same-origin", cache: "no-store", redirect: "error", signal: controller.signal,
          headers, ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
        });
      } catch {
        this.#assertCurrent(epoch, protectedRequest);
        throw new Error("网络未连接，本次操作未完成。请联网后重试。");
      }
      this.#assertCurrent(epoch, protectedRequest);
      if (protectedRequest && response.status === 401) {
        this.clear("登录状态已失效，请重新登录。");
        throw new SessionEndedError();
      }
      let result;
      try { result = blob && response.ok ? await response.blob() : await response.json(); }
      catch {
        this.#assertCurrent(epoch, protectedRequest);
        throw new Error("服务暂不可用，请稍后重试。");
      }
      this.#assertCurrent(epoch, protectedRequest);
      if (!response.ok) {
        const error = new Error(result.detail || "操作未完成，请重试。");
        error.status = response.status;
        throw error;
      }
      return result;
    } finally { this.#pending.delete(controller); }
  }
  async reset(message = "请登录后台。") {
    this.clear(message);
    const epoch = this.#epoch;
    const result = await this.#request("/session", "GET");
    this.#assertCurrent(epoch, false);
    if (!result.csrf || result.identity) throw new Error("管理登录服务需要更新，请联系平台。");
    this.#csrf = result.csrf; this.#ready = true;
  }
  async login(username, password) {
    if (!this.#ready || this.#proof) throw new Error("请重新连接后登录。");
    const epoch = this.#epoch, wallStart = this.#wall(), monoStart = this.#mono();
    const result = await this.#request("/login", "POST", { username, password });
    this.#assertCurrent(epoch, false);
    if (!result.csrf || !result.identity || result.expiresIn !== 3600) {
      this.clear("管理登录服务需要更新，请联系平台。");
      throw new SessionEndedError();
    }
    this.#csrf = result.csrf; this.#proof = result.csrf;
    // Conservatively include response travel time; the server remains authoritative.
    this.#wallEnd = wallStart + result.expiresIn * 1000;
    this.#monoEnd = monoStart + result.expiresIn * 1000;
    if (!this.check()) throw new SessionEndedError();
    this.#arm();
    return result.identity;
  }
  call(path, method = "GET", body) { return this.#request(path, method, body, { protectedRequest: true }); }
  download(path) { return this.#request(path, "GET", undefined, { protectedRequest: true, blob: true }); }
  logout() { return this.reset("已退出后台，请重新登录。"); }
}
