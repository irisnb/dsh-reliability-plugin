// driver-adapter.mjs — 真实 DSH JSONL 驱动适配器（@dsh-reliability/core）
// 实现 DshAdapter 接口，把 runReliability 的会话/发送/取消/结束映射到真实 DSH 驱动 JSONL 协议。
// 由 CLI 的 real 模式启用。driverPath 必须显式提供（真实 DSH 驱动脚本不在发布包内，见设计文档）。
// apiKey 只从环境变量注入，绝不进入证据、日志或标准输出。
import { randomUUID } from "node:crypto";
import { DriverClient } from "./driver-client.mjs";

export class DriverAdapter {
  constructor({ driverPath, apiBase = "https://api.deepseek.com", model, apiKey, home, timeoutMs = 180000 }) {
    if (!driverPath || typeof driverPath !== "string") {
      throw new Error("DriverAdapter 需要 driverPath（真实 DSH 驱动脚本路径）");
    }
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("DriverAdapter 需要 DEEPSEEK_API_KEY");
    }
    this.driverPath = driverPath;
    this.apiBase = apiBase.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.home = home;
    this.timeoutMs = timeoutMs;
    this.client = null;
  }

  async start(opts = {}) {
    if (opts.model) this.model = opts.model;
    if (opts.apiBase) this.apiBase = String(opts.apiBase).replace(/\/+$/, "");
    this.client = await DriverClient.start({
      driverPath: this.driverPath,
      apiBase: this.apiBase,
      model: this.model,
      apiKey: this.apiKey,
      home: this.home,
    });
  }

  async stop() {
    if (this.client) {
      await this.client.shutdown().catch(() => {});
      this.client = null;
    }
  }

  async startSession(seed = []) {
    const client = this.client;
    const sessionId = `rel-${randomUUID()}`;
    client.send({ type: "start_session", session_id: sessionId });
    await client.waitFor((e) => e.type === "session_started" && e.session_id === sessionId, 30000, "session_started");

    if (seed.length > 0) {
      client.send({ type: "replay_history", session_id: sessionId, turns: seed });
      client.send({ type: "replay_done", session_id: sessionId });
      await client.waitFor((e) => e.type === "replay_ok" && e.session_id === sessionId, 60000, "replay_ok");
    }

    return { id: sessionId };
  }

  async sendMessage(session, text) {
    const client = this.client;
    const messageId = `m-${randomUUID()}`;
    client.send({ type: "send_message", session_id: session.id, message_id: messageId, text });

    let terminal;
    try {
      ({ terminal } = await client.waitMessageDone(session.id, messageId, this.timeoutMs));
    } catch (err) {
      return this._errorResult(messageId, err?.category ?? "protocol_error", String(err?.message ?? err));
    }

    if (terminal.type === "message_done") {
      return {
        text: terminal.text ?? "",
        terminal: "message_done",
        code: null,
        message: null,
        messageId,
        error: null,
      };
    }
    if (terminal.type === "message_failed") {
      const message = terminal.message ?? `代码 ${terminal.code ?? "failed"}`;
      return {
        text: "",
        terminal: "message_failed",
        code: terminal.code ?? "failed",
        message,
        messageId,
        error: { category: "message_failed", message },
      };
    }
    // error 或其它未知终态
    const message = String(terminal.message ?? terminal.code ?? "协议错误");
    return {
      text: "",
      terminal: "error",
      code: terminal.code ?? "protocol_error",
      message,
      messageId,
      error: { category: "protocol_error", message },
    };
  }

  _errorResult(messageId, category, message) {
    return {
      text: "",
      terminal: "error",
      code: category,
      message,
      messageId,
      error: { category, message },
    };
  }

  async cancelMessage(session) {
    // 驱动协议 cancel_message 只需 session_id，driver 会标记取消并调用 agent.cancel()
    this.client?.send({ type: "cancel_message", session_id: session.id });
  }

  async endSession(session) {
    const client = this.client;
    try {
      client.send({ type: "end_session", session_id: session.id });
      await client.waitFor((e) => e.type === "session_ended" && e.session_id === session.id, 30000, "session_ended");
    } catch {
      // 结束会话失败尽力而为，由后续清理兜底
    }
  }
}
