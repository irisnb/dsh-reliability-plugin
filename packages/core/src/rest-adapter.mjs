// rest-adapter.mjs — 真实 DeepSeek 兼容 HTTP 适配器（@dsh-reliability/core）
// 实现 DshAdapter 接口，直接调用 OpenAI-compatible chat completions 端点。
// 仅由 CLI 的 real 模式启用；apiKey 只从环境变量注入，绝不进入证据、日志或标准输出。
// 无网络环境不会加载本模块（CLI real 模式在缺 key 时先行退出）。
import { randomUUID } from "node:crypto";

export class RestApiAdapter {
  constructor({ apiKey, apiBase = "https://api.deepseek.com", model, timeoutMs = 180000 }) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("RestApiAdapter 需要 DEEPSEEK_API_KEY");
    }
    this.apiKey = apiKey;
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.currentController = null;
  }

  async start(opts = {}) {
    if (opts.model) this.model = opts.model;
    if (opts.apiBase) this.apiBase = opts.apiBase.replace(/\/+$/, "");
  }

  async stop() {}

  async startSession(seed = []) {
    const messages = seed.map((t) => ({ role: t.role, content: t.text }));
    return { id: `real-${randomUUID()}`, messages };
  }

  async sendMessage(session, text) {
    session.messages.push({ role: "user", content: text });
    const controller = new AbortController();
    this.currentController = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ model: this.model, messages: session.messages, stream: false }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(`DeepSeek API 返回 ${res.status}: ${body.slice(0, 300)}`);
        err.category = "api_error";
        return {
          text: "",
          terminal: "message_failed",
          code: String(res.status),
          message: err.message,
          messageId: null,
          error: { category: "api_error", message: err.message },
        };
      }
      const data = await res.json();
      const text0 = data?.choices?.[0]?.message?.content ?? "";
      return {
        text: text0,
        terminal: "message_done",
        code: null,
        message: null,
        messageId: data?.id ?? null,
        error: null,
      };
    } catch (err) {
      if (err?.name === "AbortError") {
        return {
          text: "",
          terminal: "message_failed",
          code: "timeout",
          message: `请求超时（${this.timeoutMs}ms）`,
          messageId: null,
          error: { category: "timeout", message: `请求超时（${this.timeoutMs}ms）` },
        };
      }
      return {
        text: "",
        terminal: "error",
        code: "network",
        message: String(err?.message ?? err),
        messageId: null,
        error: { category: "network", message: String(err?.message ?? err) },
      };
    } finally {
      clearTimeout(timer);
      if (this.currentController === controller) this.currentController = null;
    }
  }

  async cancelMessage() {
    // 中止当前在途请求，让 sendMessage 快速返回 timeout/aborted 结果，不留未处理请求。
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
  }

  async endSession(session) {
    session.messages = [];
  }
}
