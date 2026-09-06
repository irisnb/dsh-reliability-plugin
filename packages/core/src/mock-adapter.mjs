// mock-adapter.mjs — 确定性离线 Mock 适配器（@dsh-reliability/core）
// 实现 DshAdapter 接口，不请求网络、不需要 API key。用于离线验证案例校验、评分、证据输出
// 与故障注入。默认策略 "echo-material"：把材料原文作为回答（命中 mustContain 事实 → PASS_LIKELY）。
//
// 可控输入：
//   responses    { caseId: string | (ctx)=>string }  固定回答或回答函数
//   errors       { caseId: { category, message } }     强制该案例为运行错误（RUNTIME_ERROR）
//   defaultPolicy "echo-material" | "unknown" | "empty"  未显式指定时的回答策略
import { randomUUID } from "node:crypto";

export class MockAdapter {
  constructor({ responses = {}, errors = {}, defaultPolicy = "echo-material" } = {}) {
    this.responses = responses;
    this.errors = errors;
    this.defaultPolicy = defaultPolicy;
    this.sessions = new Map();
  }

  async start() {}

  async stop() {
    this.sessions.clear();
  }

  async startSession(seed, meta = {}) {
    const id = `mock-${randomUUID()}`;
    this.sessions.set(id, { seed, caseId: meta.caseId, material: meta.material, n: 0 });
    return { id };
  }

  async sendMessage(session, text) {
    const s = this.sessions.get(session?.id);
    const n = (s?.n ?? 0) + 1;
    if (s) s.n = n;

    const caseId = s?.caseId;
    const err = caseId ? this.errors[caseId] : undefined;
    if (err) {
      return {
        text: "",
        terminal: "message_failed",
        code: err.category ?? "mock_error",
        message: err.message ?? "",
        messageId: `${session?.id ?? "mock"}-m${n}`,
        error: { category: err.category ?? "mock_error", message: err.message ?? "" },
      };
    }

    const explicit = caseId ? this.responses[caseId] : undefined;
    let text0;
    if (typeof explicit === "function") {
      text0 = explicit({ question: text, material: s?.material, turn: n });
    } else if (typeof explicit === "string") {
      text0 = explicit;
    } else {
      text0 = this._defaultAnswer(s);
    }

    return {
      text: text0,
      terminal: "message_done",
      code: null,
      message: null,
      messageId: `${session?.id ?? "mock"}-m${n}`,
      error: null,
    };
  }

  _defaultAnswer(s) {
    switch (this.defaultPolicy) {
      case "unknown":
        return "根据材料无法确定（材料未提及相关内容）。";
      case "empty":
        return "";
      case "echo-material":
      default:
        return s?.material?.text ?? "";
    }
  }

  async cancelMessage() {}

  async endSession(session) {
    if (session?.id) this.sessions.delete(session.id);
  }
}
