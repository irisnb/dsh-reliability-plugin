// redact.mjs — 插件层基础密钥脱敏（@dsh-reliability/dsh-plugin）
// 插件可能被独立用作观测 sink（不经 core 的 evidence-store 落盘前脱敏），因此必须在事件
// 转发前对文本与 meta 做基础脱敏，避免独立 sink 直接泄漏 API key。
// 这里只做「通用模式」脱敏（sk- 前缀、Bearer 令牌）；精确 key 的脱敏由 core 在落盘前统一复核。

const GENERIC_KEY_SOURCE = "sk-[A-Za-z0-9_-]{8,}";
const BEARER_SOURCE = /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi;

/** 对单段文本做基础脱敏。 */
export function redactEventText(text) {
  return String(text ?? "")
    .replace(new RegExp(GENERIC_KEY_SOURCE, "g"), "[REDACTED]")
    .replace(BEARER_SOURCE, "Bearer [REDACTED]");
}

/** 对归一化事件做基础脱敏（text 与 meta 字符串值），返回新对象，不修改入参。 */
export function redactEvent(event) {
  if (!event || typeof event !== "object") return event;
  const out = { ...event };
  if (typeof out.text === "string") out.text = redactEventText(out.text);
  if (out.meta && typeof out.meta === "object") {
    const m = {};
    for (const [k, v] of Object.entries(out.meta)) {
      m[k] = typeof v === "string" ? redactEventText(v) : v;
    }
    out.meta = m;
  }
  return out;
}
