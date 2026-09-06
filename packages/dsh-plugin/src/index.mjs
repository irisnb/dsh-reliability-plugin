// index.mjs — @dsh-reliability/dsh-plugin
// 标准 DSH Cordis 测试插件：默认只读观测，显式开启时才提供 Mock LLM 与故障注入。
//
// 关键约束：
//   - 不注册供模型自主调用的可靠性测试 Tool；
//   - 不修改请求参数或模型回答；
//   - 不写入用户文件或作品数据；
//   - 不自行判定 PASS_LIKELY / FAIL_LIKELY / 人工复核结果；
//   - 不覆盖 DSH 生产工具安全配置。
//
// 本模块不 import @deepseek-ai/dsh 或 cordis：插件可独立加载（standalone 模式），
// 也作为标准 Cordis 插件（apply 函数）加载进 DSH 测试容器。@deepseek-ai/dsh 的兼容版本
// 通过 package.json 的 optional peerDependency 精确声明为 0.1.0-rc.7。
//
// apply() 基于当前仓库真实可用的 Cordis 事件接口订阅生命周期事件（能力检测 wrapper）：
//   - ctx.on("session/event", (session, event) => …)  会话事件 firehose（LLM 请求/响应/压缩/失败）
//   - ctx.on("session/created", (session) => …)        会话生命周期 → session_started
//   - ctx.on("agent/created",   ({ agent }) => …)      Agent 生命周期 → session_started（与会话去重）
// 事件自动进入 ProbeSink，无需宿主手动调用 observe。observe() 保留为白盒宿主显式转发的兼容入口。

export const name = "reliability-probe";
export const inject = [];

import { createProbeSink, createRunScope, normalizeEvent, TRACE_KINDS } from "./probe.mjs";
import { createMockLlm } from "./mock-llm.mjs";
import { createFaultInjector } from "./fault-injection.mjs";
import { redactEvent } from "./redact.mjs";

export { createProbeSink, createRunScope, normalizeEvent, TRACE_KINDS };
export { createMockLlm };
export { createFaultInjector };
export { redactEvent, redactEventText } from "./redact.mjs";

/**
 * 标准 Cordis 插件入口。
 * @param {object} [ctx] Cordis 上下文（可能不存在，standalone 模式）
 * @param {object} [options] 测试配置
 * @param {object} [options.sink] 外部 ProbeSink（默认创建进程内 sink）
 * @param {object} [options.scope] 外部 RunScope（默认创建，用于稳定标识分配）
 * @param {object} [options.adapter] 供故障注入包裹的 DshAdapter（可选）
 * @param {object} [options.mock] Mock LLM 配置（enabled 默认 false）
 * @param {object} [options.fault] 故障注入配置（enabled 默认 false）
 */
export function apply(ctx, options = {}) {
  const scope = options.scope ?? createRunScope();
  const sink = options.sink ?? createProbeSink();
  const mock = createMockLlm(options.mock ?? {});
  const fault = createFaultInjector({ sink, adapter: options.adapter, enabled: options.fault?.enabled === true });

  const disposers = [];
  const seenSessions = new Set();
  const currentTurn = new Map(); // sessionId -> 当前轮次号（用于缺少 data.turn 的事件）

  /** 归一化并转发到 sink；返回归一化事件（未识别为 null）。 */
  function forward(raw, sessionCtx = {}) {
    const session = sessionCtx.session ?? sessionCtx.sessionObj ?? null;
    const sessionId0 = sessionCtx.sessionId ?? (session && typeof session === "object" ? session.id : null);
    const sessionId = scope.sessionIdFor(session, sessionId0);
    const evt = normalizeEvent(raw, {
      sessionId,
      // 事件自身带 data.turn 时优先（normalizeEvent 内部取 raw.data.turn）；否则回退到当前轮次
      turnNo: currentTurn.get(sessionId) ?? null,
      messageId: sessionCtx.messageId ?? null,
      session,
    }, scope);
    if (evt) {
      // 插件层基础脱敏：即使独立 sink（不经 core 落盘前脱敏）也不泄漏 API key。
      sink.onEvent(redactEvent(evt));
    }
    return evt;
  }

  /** 向 sink 发一次 session_started（按 sessionId 去重）。 */
  function announceSession(session) {
    const sessionId = scope.sessionIdFor(session, session && typeof session === "object" ? session.id : null);
    if (seenSessions.has(sessionId)) return;
    seenSessions.add(sessionId);
    forward({ type: "session_started" }, { sessionId, session });
  }

  // ── 能力检测订阅（ctx.on 是当前 Cordis 4.x 的稳定接口）──────────────────────
  const subscribe = (eventName, handler) => {
    if (ctx && typeof ctx.on === "function") {
      try {
        const off = ctx.on(eventName, handler);
        if (typeof off === "function") disposers.push(off);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  };

  // LLM 生命周期 firehose：会话每次 append 事件都会同步派发 (session, event)
  subscribe("session/event", (session, event) => {
    const sessionId = scope.sessionIdFor(session, session && typeof session === "object" ? session.id : null);
    if (event?.type === "turn/start" && event?.data?.turn != null) {
      currentTurn.set(sessionId, event.data.turn);
    }
    if (event?.type === "turn/end") {
      currentTurn.delete(sessionId);
    }
    forward(event, { sessionId, session });
  });

  // 会话 + Agent 生命周期 → session_started（同一 session 只发一次）
  subscribe("session/created", (session) => announceSession(session));
  subscribe("agent/created", (payload) => {
    const agent = payload?.agent ?? (payload && typeof payload === "object" ? payload : null);
    if (agent?.session) announceSession(agent.session);
  });

  const api = {
    name,
    sink,
    mock,
    fault,
    scope,
    /**
     * 白盒观测入口：把原始 DSH 生命周期事件归一化后转发给 sink（兼容旧调用方）。
     * 测试宿主遍历 agent.session.events 时逐条调用；未识别事件返回 null（不转发）。
     */
    observe(raw, sessionCtx = {}) {
      return forward(raw, sessionCtx);
    },
    /** 解除全部事件订阅（幂等）。 */
    dispose() {
      for (const d of disposers) {
        try { d(); } catch { /* 忽略 */ }
      }
      disposers.length = 0;
    },
  };

  // 标准 Cordis 服务注册：让测试组件能通过 ctx.get("reliability.probe") 取到探针。
  // 仅使用 Cordis 稳定的 ctx.provide 接口；不存在该接口时静默降级为 standalone。
  // 保存 provide 返回的 disposer 并在 dispose() 时调用；只忽略「同名服务重复注册」这类
  // 幂等冲突，其它错误（真实缺陷）向上抛出，不无条件吞掉。
  if (ctx && typeof ctx.provide === "function") {
    try {
      const disposer = ctx.provide("reliability.probe", api);
      if (typeof disposer === "function") disposers.push(disposer);
    } catch (err) {
      if (isDuplicateServiceError(err)) {
        // 同名服务已注册：插件幂等加载场景，明确降级（不注册、不重抛）。
      } else {
        throw err;
      }
    }
  }

  return api;
}

/** 判断是否 Cordis 同名服务重复注册错误（依据 cordis 4.x provide 的报错文案）。 */
function isDuplicateServiceError(err) {
  const msg = String(err?.message ?? err ?? "");
  return msg.includes("has been registered") || msg.includes("already declared");
}

export default apply;
