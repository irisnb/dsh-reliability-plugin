// probe.mjs — 白盒事件探针（@dsh-reliability/dsh-plugin）
// 提供进程内 ProbeSink、运行内稳定标识分配器（RunScope）与 DshTraceEvent 归一化。
// 事件必须携带稳定的会话/轮次/消息标识；转发前经插件层基础脱敏（见 redact.mjs），
// 避免独立 sink 直接泄漏 API key；精确 key 的脱敏复核由 core 的 evidence-store 落盘前统一处理。
//
// 本模块不 import @deepseek-ai/dsh 或 cordis：探针可独立于 DSH 运行（standalone 模式）。
// 事件标识缺失时由 RunScope 生成「确定且非空」的运行内标识，保证下游证据字段稳定。

/** DshTraceEvent 的稳定 kind 集合。 */
export const TRACE_KINDS = [
  "session_started",
  "request_started",
  "response_delta",
  "response_complete",
  "compaction",
  "request_failed",
];

/** 进程内探针事件缓冲。flush() 返回并清空缓冲，events() 返回只读快照。 */
export function createProbeSink() {
  const buffer = [];
  return {
    onEvent(event) {
      if (event && typeof event === "object") buffer.push(event);
    },
    events() {
      return [...buffer];
    },
    async flush() {
      return buffer.splice(0, buffer.length);
    },
    clear() {
      buffer.length = 0;
    },
  };
}

/**
 * 运行内标识分配器：为缺失的 sessionId/turnId/messageId 生成确定（稳定、单调）且非空的标识。
 * - sessionId：优先用 session 对象的 id；否则按 session 对象（WeakMap）或字符串 key 稳定复用；再无则生成合成 id。
 * - turnId：优先用轮次号（turn-N）或显式 hint；否则按会话计数生成。
 * - messageId：优先用消息 id hint；否则按会话计数生成。
 * 同一次运行内，相同输入得到相同/单调的标识，绝不返回空值。
 */
export function createRunScope({ prefix = "rel" } = {}) {
  const sessionIds = new WeakMap();   // session 对象 -> 合成 sessionId
  const sessionKeys = new Map();      // 字符串 key -> 合成 sessionId
  const turnCounters = new Map();     // sessionId -> 计数
  const messageCounters = new Map();  // sessionId -> 计数
  let n = 0;
  const gen = (tag) => `${prefix}-${tag}-${++n}`;

  return {
    sessionIdFor(session, key) {
      if (session && typeof session === "object" && typeof session.id === "string" && session.id !== "") {
        return session.id;
      }
      if (session && typeof session === "object") {
        let id = sessionIds.get(session);
        if (!id) {
          id = gen("session");
          sessionIds.set(session, id);
        }
        return id;
      }
      const k = key != null && key !== "" ? String(key) : null;
      if (k) {
        if (!sessionKeys.has(k)) sessionKeys.set(k, gen("session"));
        return sessionKeys.get(k);
      }
      return gen("session");
    },
    turnIdFor(sessionId, turnNo, hint) {
      if (hint != null && hint !== "") return String(hint);
      if (turnNo != null && turnNo !== "") return `turn-${turnNo}`;
      const c = (turnCounters.get(sessionId) ?? 0) + 1;
      turnCounters.set(sessionId, c);
      return `turn-${sessionId}-${c}`;
    },
    messageIdFor(sessionId, hint) {
      if (hint != null && hint !== "") return String(hint);
      const c = (messageCounters.get(sessionId) ?? 0) + 1;
      messageCounters.set(sessionId, c);
      return `msg-${sessionId}-${c}`;
    },
  };
}

/** 从 assistant/chunk 事件抽取增量文本（运行时形状探测，与 sidecar/probe/probe.mjs 一致）。 */
function extractChunkText(event) {
  const d = event?.data ?? {};
  for (const key of ["delta", "text", "chunk"]) {
    const v = d[key];
    if (typeof v === "string") return v;
    if (v && typeof v === "object" && typeof v.text === "string") return v.text;
  }
  return null;
}

/**
 * 从 message 事件抽取完整文本。兼容两种真实 DSH 形状：
 *   assistant/message → data.message.content（数组）
 *   user/message      → data 即消息本体（data.content 数组）
 */
function extractMessageText(event) {
  const data = event?.data ?? {};
  const message = data.message ?? data;
  const content = message?.content ?? event?.text;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === "text").map((b) => b.text).join("");
  }
  return null;
}

/**
 * 把原始 DSH 生命周期事件归一化为 DshTraceEvent。
 * 已知事件类型（来自 sidecar/probe/probe.mjs 与 sidecar/driver/driver.mjs）：
 *   session_started → session_started
 *   user/message    → request_started
 *   assistant/chunk → response_delta
 *   assistant/message / message_done → response_complete
 *   compaction/*    → compaction
 *   message_failed / error → request_failed
 * 未识别的事件返回 null（保持稳定契约，不转发未知形状）。
 * @param {object} raw 原始事件
 * @param {object} [ctx] 会话上下文 { sessionId, turnId, messageId, session }
 * @param {object} [scope] 可选 RunScope（createRunScope）；提供时缺失标识被稳定生成
 */
export function normalizeEvent(raw, ctx = {}, scope) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw?.type ?? "";

  const sessionId0 = raw?.sessionId ?? raw?.session_id ?? ctx.sessionId ?? null;
  const turnNo = raw?.data?.turn ?? raw?.turn ?? ctx.turnNo ?? null;
  const turnId0 = ctx.turnId ?? (turnNo != null ? `turn-${turnNo}` : null);
  const messageId0 = raw?.messageId ?? raw?.message_id ?? raw?.data?.message?.id ?? raw?.data?.id ?? ctx.messageId ?? null;
  const seq = typeof raw?.seq === "number" ? raw.seq : null;

  let kind = null;
  let text = null;
  let meta = null;

  switch (type) {
    case "session_started":
    case "session/start":
      kind = "session_started";
      break;
    case "user/message":
    case "request_started":
    case "request/start":
      kind = "request_started";
      text = extractMessageText(raw);
      break;
    case "assistant/chunk":
    case "response_delta":
    case "delta":
      kind = "response_delta";
      text = extractChunkText(raw);
      break;
    case "assistant/message":
    case "message_done":
    case "response_complete":
      kind = "response_complete";
      text = extractMessageText(raw);
      break;
    case "message_failed":
    case "error":
    case "request_failed":
      kind = "request_failed";
      text = raw?.message ?? null;
      meta = { code: raw?.code ?? null };
      break;
    default:
      if (String(type).startsWith("compaction/")) {
        kind = "compaction";
        meta = { summary: typeof raw?.data?.summary === "string" ? raw.data.summary.slice(0, 200) : null };
      } else {
        return null;
      }
  }

  // 稳定标识：先取原始/上下文值，缺失时由 scope 生成确定且非空的运行内标识。
  let sessionId = sessionId0;
  let turnId = turnId0;
  let messageId = messageId0;
  if (scope) {
    sessionId = scope.sessionIdFor(ctx.session, sessionId);
    turnId = scope.turnIdFor(sessionId, turnNo, turnId);
    messageId = scope.messageIdFor(sessionId, messageId);
  }
  // 无 scope 时的兜底：保证非空（standalone 直接调用 normalizeEvent 的场景）。
  sessionId = sessionId || "session-unknown";
  turnId = turnId || "turn-unknown";
  messageId = messageId || "msg-unknown";

  return {
    kind,
    sessionId,
    turnId,
    messageId,
    seq,
    text,
    meta,
    timestamp: typeof raw?.time === "number" ? raw.time : Date.now(),
  };
}
