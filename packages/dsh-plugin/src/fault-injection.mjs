// fault-injection.mjs — 显式测试故障注入（@dsh-reliability/dsh-plugin）
// 注入超时、取消、协议错误与「模拟异常退出」等故障。仅在 enabled 时生效，否则所有注入方法返回 null（no-op）。
//
// 故障注入必须有「真实可观察行为」：除了向 sink 转发一条 request_failed 事件外，还会
// 让被包裹（wrap）的 adapter 在下次调用时真正返回超时/取消/协议失败/模拟异常退出等结构化结果，
// 而不是只发一条事件就完事。未包裹 adapter 时，注入仍记录 pending 故障并转发事件，
// 供调用方自行消费。
//
// 明确边界：simulated_abnormal_exit 是「模拟」能力——它结构化返回 error 结果，
// 不真实终止任何进程；如需真实进程异常退出恢复，请另立能力，不在此声称。

import { redactEvent } from "./redact.mjs";

const FAULT_LABELS = {
  timeout: "注入超时",
  cancel: "注入取消",
  protocol_error: "注入协议错误",
  simulated_abnormal_exit: "注入模拟异常退出（非真实进程终止）",
};

export function createFaultInjector({ sink, adapter, enabled = false } = {}) {
  const pending = []; // 待注入的故障队列（FIFO）

  function emitFault(fault, detail = {}) {
    if (!enabled) return null;
    // detail 会进入 sink 事件的 meta，必须经与插件一致的基础 secret redaction，避免独立 sink 泄漏密钥。
    const evt = redactEvent({
      kind: "request_failed",
      sessionId: null,
      turnId: null,
      messageId: null,
      seq: null,
      text: null,
      meta: { fault, ...detail },
      timestamp: Date.now(),
    });
    if (sink && typeof sink.onEvent === "function") sink.onEvent(evt);
    return evt;
  }

  /** 记录一次待注入故障并转发事件。未启用时返回 null。 */
  function inject(fault, detail = {}) {
    if (!enabled) return null;
    pending.push(fault);
    return emitFault(fault, detail);
  }

  /** 让 adapter 的下一次 sendMessage 真正以结构化结果失败（超时/取消/协议错误/异常退出）。 */
  function wrap(target) {
    if (!target || typeof target.sendMessage !== "function") return target;
    const original = target.sendMessage.bind(target);
    target.sendMessage = async (session, text) => {
      const fault = pending.shift();
      if (fault) {
        return {
          text: "",
          terminal: fault === "protocol_error" || fault === "simulated_abnormal_exit" ? "error" : "message_failed",
          code: fault,
          message: FAULT_LABELS[fault] ?? fault,
          messageId: null,
          error: { category: fault, message: FAULT_LABELS[fault] ?? fault },
        };
      }
      return original(session, text);
    };
    return target;
  }

  const api = {
    enabled,
    wrap,
    timeout(detail) { return inject("timeout", detail); },
    cancel(detail) { return inject("cancel", detail); },
    protocolError(detail) { return inject("protocol_error", detail); },
    // 明确边界：这是「模拟」异常退出（结构化返回 error 结果），不真实终止任何进程。
    simulatedAbnormalExit(detail) { return inject("simulated_abnormal_exit", detail); },
  };

  if (adapter) wrap(adapter);

  return api;
}
