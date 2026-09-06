// dsh-plugin-lifecycle.test.mjs — 插件生命周期订阅与稳定标识回归测试
// 覆盖评审阻塞项：
//   1) apply() 基于真实 Cordis 事件接口（ctx.on）订阅生命周期事件，事件自动进入 sink，无需宿主手动 observe
//   2) 稳定事件必有非空 sessionId/turnId/messageId，缺失时由插件生成确定且非空的运行内标识
//   3) 故障注入必须有真实可观察行为（包裹 adapter 后返回超时/取消/协议失败结果），而非只发事件
import assert from "node:assert/strict";
import test from "node:test";

import { apply, createProbeSink, createFaultInjector } from "@dsh-reliability/dsh-plugin";

/** 模拟 Cordis 事件总线的轻量上下文（能力检测 wrapper 的测试替身）。 */
function makeFakeCtx() {
  const listeners = new Map();
  return {
    listeners,
    provided: {},
    on(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return () => {
        const i = list.indexOf(fn);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit(name, ...args) {
      for (const fn of listeners.get(name) ?? []) fn(...args);
    },
    provide(k, v) {
      this.provided[k] = v;
    },
  };
}

test("apply 订阅 session/event 生命周期，事件自动进入 sink（无需手动 observe）", () => {
  const ctx = makeFakeCtx();
  const api = apply(ctx, {});
  assert.ok(ctx.listeners.has("session/event"), "已订阅 session/event");

  ctx.emit("session/event", { id: "s1" }, {
    type: "user/message",
    seq: 0,
    time: 1,
    data: { id: "m1", role: "user", source: { kind: "user" }, content: [{ type: "text", text: "你好" }] },
  });

  const events = api.sink.events();
  assert.equal(events.length, 1, "事件自动进入 sink");
  assert.equal(events[0].kind, "request_started");
  assert.equal(events[0].sessionId, "s1");
  assert.equal(events[0].text, "你好", "user/message 文本被正确抽取");
});

test("apply 订阅 agent/created 生命周期 → 自动发出 session_started", () => {
  const ctx = makeFakeCtx();
  const api = apply(ctx, {});
  ctx.emit("agent/created", { agent: { session: { id: "s2" } } });

  const events = api.sink.events();
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "session_started");
  assert.equal(events[0].sessionId, "s2");
});

test("apply 订阅 session/created 生命周期 → 自动发出 session_started（与 agent/created 去重）", () => {
  const ctx = makeFakeCtx();
  const api = apply(ctx, {});
  ctx.emit("session/created", { id: "s3" });
  ctx.emit("agent/created", { agent: { session: { id: "s3" } } });

  const starts = api.sink.events().filter((e) => e.kind === "session_started");
  assert.equal(starts.length, 1, "同一会话只发一次 session_started");
  assert.equal(starts[0].sessionId, "s3");
});

test("稳定事件必有非空 sessionId/turnId/messageId，缺失时生成确定且非空的运行内标识", () => {
  const ctx = makeFakeCtx();
  const api = apply(ctx, {});
  // assistant/chunk 无 messageId；靠插件生成稳定标识
  ctx.emit("session/event", { id: "s4" }, { type: "assistant/chunk", seq: 5, time: 1, data: { turn: 2, chunk: { type: "text-delta", text: "增量" } } });
  ctx.emit("session/event", { id: "s4" }, { type: "assistant/chunk", seq: 6, time: 2, data: { turn: 2, chunk: { type: "text-delta", text: "继续" } } });

  const events = api.sink.events();
  assert.equal(events.length, 2);
  for (const e of events) {
    assert.ok(e.sessionId && e.sessionId.length > 0, "sessionId 非空");
    assert.ok(e.turnId && e.turnId.length > 0, "turnId 非空");
    assert.ok(e.messageId && e.messageId.length > 0, "messageId 非空");
  }
  assert.equal(events[0].sessionId, "s4");
  assert.equal(events[1].sessionId, "s4", "同一会话的 sessionId 稳定");
  assert.equal(events[0].turnId, "turn-2");
  assert.equal(events[1].turnId, "turn-2", "同一轮次的 turnId 稳定");
  assert.notEqual(events[0].messageId, "", "messageId 非空");
  assert.notEqual(events[1].messageId, "", "messageId 非空");
});

test("故障注入包裹 adapter 后产生真实可观察的超时结果（不再只发事件）", async () => {
  const sink = createProbeSink();
  const calls = [];
  const adapter = {
    async sendMessage(session, text) {
      calls.push(text);
      return { text: "ok", terminal: "message_done" };
    },
  };
  const fault = createFaultInjector({ sink, adapter, enabled: true });
  fault.timeout({ ms: 100 });

  const result = await adapter.sendMessage({ id: "s" }, "q");
  assert.equal(result.terminal, "message_failed");
  assert.equal(result.code, "timeout");
  assert.equal(result.error.category, "timeout");
  assert.equal(calls.length, 0, "故障注入拦截，不调用原 adapter");
  assert.equal(sink.events().length, 1);
  assert.equal(sink.events()[0].meta.fault, "timeout");
});

test("故障注入支持取消与协议失败的可观察结果", async () => {
  const sink = createProbeSink();
  const adapter = { async sendMessage() { return { text: "ok", terminal: "message_done" }; } };
  const fault = createFaultInjector({ sink, adapter, enabled: true });

  fault.cancel({});
  const cancelled = await adapter.sendMessage({ id: "s" }, "q");
  assert.equal(cancelled.code, "cancel");

  fault.protocolError({});
  const proto = await adapter.sendMessage({ id: "s" }, "q");
  assert.equal(proto.terminal, "error");
  assert.equal(proto.error.category, "protocol_error");
});
