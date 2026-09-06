// dsh-plugin.test.mjs — 插件契约测试：标准 Cordis 导出、默认只读、事件转发、Mock 与故障注入显式开关。
import assert from "node:assert/strict";
import test from "node:test";

import pluginDefault, {
  apply,
  name,
  inject,
  createProbeSink,
  normalizeEvent,
  createMockLlm,
  createFaultInjector,
  TRACE_KINDS,
} from "@dsh-reliability/dsh-plugin";

test("导出标准 Cordis 契约（apply / default / name / inject）", () => {
  assert.equal(name, "reliability-probe");
  assert.deepEqual(inject, []);
  assert.equal(typeof apply, "function");
  assert.equal(typeof pluginDefault, "function");
});

test("apply 默认只读：不注册 tool，Mock 与故障注入均未启用", () => {
  const provided = {};
  const toolsRegistered = [];
  const ctx = {
    provide: (k, v) => { provided[k] = v; },
    on: () => {},
    effect: () => {},
    // 模拟 tool 注册接口：插件绝不能调用它
    tools: { register: (...args) => toolsRegistered.push(args) },
  };
  const api = apply(ctx, {});
  assert.equal(api.mock.enabled, false, "默认 Mock 未启用");
  assert.equal(api.fault.enabled, false, "默认故障注入未启用");
  assert.equal(provided["reliability.probe"], api);
  assert.equal(toolsRegistered.length, 0, "插件不注册任何 tool");
});

test("ProbeSink 转发事件，flush 清空缓冲", async () => {
  const sink = createProbeSink();
  sink.onEvent({ kind: "session_started" });
  sink.onEvent({ kind: "response_complete" });
  assert.equal(sink.events().length, 2);
  const flushed = await sink.flush();
  assert.equal(flushed.length, 2);
  assert.equal(sink.events().length, 0);
});

test("normalizeEvent 映射已知 DSH 事件类型并丢弃未知类型", () => {
  assert.equal(normalizeEvent({ type: "session_started", session_id: "s1" }).kind, "session_started");
  assert.equal(
    normalizeEvent({ type: "user/message", data: { message: { content: [{ type: "text", text: "你好" }] } } }).kind,
    "request_started",
  );
  const delta = normalizeEvent({ type: "assistant/chunk", data: { chunk: { type: "text-delta", text: "增量" } }, seq: 1 });
  assert.equal(delta.kind, "response_delta");
  assert.equal(delta.text, "增量");
  const done = normalizeEvent({ type: "assistant/message", data: { message: { content: [{ type: "text", text: "完整" }] } } });
  assert.equal(done.kind, "response_complete");
  assert.equal(done.text, "完整");
  const failed = normalizeEvent({ type: "message_failed", code: "timeout" });
  assert.equal(failed.kind, "request_failed");
  assert.equal(failed.meta.code, "timeout");
  assert.equal(normalizeEvent({ type: "compaction/summary" }).kind, "compaction");
  assert.equal(normalizeEvent({ type: "unknown/type" }), null);
  assert.ok(TRACE_KINDS.includes("request_failed"));
});

test("observe 转发到 sink，未识别事件返回 null 且不转发", () => {
  const api = apply({ provide: () => {} }, {});
  const evt = api.observe({ type: "assistant/chunk", data: { delta: "x" } });
  assert.equal(evt.kind, "response_delta");
  assert.equal(api.sink.events().length, 1);
  assert.equal(api.observe({ type: "nope" }), null);
  assert.equal(api.sink.events().length, 1);
});

test("插件层对事件做基础 secret redaction，独立 sink 不泄漏 API key", () => {
  const api = apply({ provide: () => {} }, {});
  const key = "sk-pluginkey-abcdef12345678";
  // 事件文本与 meta 都携带 key，经插件转发后必须脱敏
  api.observe({ type: "assistant/chunk", data: { delta: `密钥是 ${key}`, error: `Bearer ${key}` } });
  const evt = api.observe({ type: "message_failed", code: "timeout", message: `请求失败：${key}` });

  assert.ok(api.sink.events().length >= 2);
  for (const e of api.sink.events()) {
    const serialized = JSON.stringify(e);
    assert.ok(!serialized.includes(key), `sink 事件不得泄漏 key：${serialized}`);
  }
  assert.equal(evt.kind, "request_failed");
});

test("Mock LLM 未启用不生效，启用后返回确定性回答", () => {
  assert.equal(createMockLlm({ enabled: false }).respond({ text: "q" }), null);
  assert.match(createMockLlm({ enabled: true, defaultPolicy: "unknown" }).respond({ text: "q" }), /无法确定/);
  assert.equal(createMockLlm({ enabled: true, defaultPolicy: "echo-material" }).respond({ text: "q", material: { text: "材料" } }), "材料");
  assert.equal(createMockLlm({ enabled: true, responses: { q: "固定回答" } }).respond({ text: "q" }), "固定回答");
});

test("故障注入仅在启用时生效并转发结构化事件到 sink", () => {
  const sink = createProbeSink();
  const off = createFaultInjector({ sink, enabled: false });
  assert.equal(off.timeout({}), null);
  assert.equal(sink.events().length, 0);

  const on = createFaultInjector({ sink, enabled: true });
  const evt = on.timeout({ ms: 100 });
  assert.equal(evt.kind, "request_failed");
  assert.equal(evt.meta.fault, "timeout");
  assert.equal(sink.events().length, 1);
  assert.equal(sink.events()[0].kind, "request_failed");

  on.protocolError({});
  on.simulatedAbnormalExit({});
  assert.equal(sink.events().length, 3);
});

test("异常退出是模拟能力（simulated_abnormal_exit）：结构化返回 error 结果，不真实终止进程", async () => {
  const sink = createProbeSink();
  const adapter = { async sendMessage() { return { text: "ok", terminal: "message_done" }; } };
  const fault = createFaultInjector({ sink, adapter, enabled: true });
  assert.equal(typeof fault.simulatedAbnormalExit, "function", "提供 simulated_abnormal_exit 能力");
  assert.equal(fault.abnormalExit, undefined, "不再暴露声称真实异常退出的 abnormalExit");

  fault.simulatedAbnormalExit({});
  const result = await adapter.sendMessage({ id: "s" }, "q");
  assert.equal(result.terminal, "error");
  assert.equal(result.code, "simulated_abnormal_exit");
  assert.equal(result.error.category, "simulated_abnormal_exit");
  assert.match(result.error.message, /模拟/);
});

test("fault-injection 写入 sink 的 detail/meta 经过基础 secret redaction", () => {
  const sink = createProbeSink();
  const fault = createFaultInjector({ sink, enabled: true });
  const skKey = "sk-faultkey-abcdef12345678";

  fault.timeout({ message: `超时，密钥是 ${skKey}` });
  fault.protocolError({ reason: `协议错误 Bearer ${skKey}` });
  fault.simulatedAbnormalExit({ note: `模拟异常退出：${skKey} 与 Bearer ${skKey}` });

  const events = sink.events();
  assert.equal(events.length, 3);
  for (const e of events) {
    const serialized = JSON.stringify(e);
    assert.ok(!serialized.includes(skKey), `sink 事件不得泄漏 sk- key：${serialized}`);
    assert.ok(!/Bearer\s+sk-/.test(serialized), `Bearer 令牌应被脱敏：${serialized}`);
  }
  assert.ok(JSON.stringify(events[0]).includes("[REDACTED]"), "timeout detail 应含脱敏占位");
  assert.ok(JSON.stringify(events[1]).includes("[REDACTED]"), "protocolError detail 应含脱敏占位");
});
