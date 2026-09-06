// runner-events.test.mjs — runner 接收 ProbeSink/trace sink、证据落盘与超时生效回归测试
// 覆盖评审阻塞项：
//   2) runReliability 真正接收 trace sink，把插件事件写入每案例证据，delta_count 不得固定为 0，timeout 必须生效
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runReliability, MockAdapter, materialHash, RESULT_RUNTIME_ERROR } from "@dsh-reliability/core";

function makeCase(id, { text, mustContain = [], question = "问题？" } = {}) {
  return {
    id,
    material: { name: "测试材料", version: "1", hash: materialHash(text), text },
    question,
    expect: {
      factBoundary: { mustContain, mustNegate: [] },
      wrongConclusions: [],
      allowedUncertainty: [],
      evidenceLocations: ["第一句"],
      riskTags: ["test"],
    },
  };
}

test("runReliability 接收 sink 并把插件事件写入每案例证据，delta_count 非 0", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-evt-"));
  const events = [];
  const sink = { onEvent: (e) => events.push(e) };

  const material = "林悦在城东的图书馆工作。";
  const cases = [makeCase("c1", { text: material, mustContain: ["城东的图书馆"] })];
  const adapter = new MockAdapter({ responses: { c1: material } });

  const result = await runReliability({
    cases, adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r", sink,
  });

  assert.ok(events.length > 0, "sink 收到事件");
  for (const kind of ["session_started", "request_started", "response_delta", "response_complete"]) {
    assert.ok(events.some((e) => e.kind === kind), `sink 收到 ${kind}`);
  }

  const evidence = JSON.parse(readFileSync(join(result.evidenceDir, "cases", "c1.json"), "utf8"));
  assert.ok(Array.isArray(evidence.trace?.events), "证据包含 trace.events");
  assert.ok(evidence.trace.events.length > 0, "trace.events 非空");
  assert.ok(evidence.protocol.delta_count > 0, "delta_count 不得为 0");

  for (const e of evidence.trace.events) {
    assert.ok(e.sessionId, "sessionId 非空");
    assert.ok(e.turnId, "turnId 非空");
    assert.ok(e.messageId, "messageId 非空");
  }

  rmSync(tmp, { recursive: true, force: true });
});

test("runReliability 的 timeout 参数生效：慢适配器触发 RUNTIME_ERROR（timeout）", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-to-"));
  const cases = [makeCase("slow", { text: "材料", mustContain: ["事实"] })];

  const slowAdapter = {
    async start() {},
    async stop() {},
    async startSession() { return { id: "s" }; },
    // 永不返回（不挂定时器，不阻塞事件循环退出）
    async sendMessage() { return new Promise(() => {}); },
    async endSession() {},
  };

  const t0 = Date.now();
  const result = await runReliability({
    cases, adapter: slowAdapter, model: "m", mode: "mock", outputDir: tmp, runId: "r", timeoutMs: 50,
  });
  const elapsed = Date.now() - t0;

  assert.equal(result.counts.runtime_error, 1, "应判定为运行错误");
  assert.ok(elapsed < 3000, `超时应生效，实际耗时 ${elapsed}ms`);

  const evidence = JSON.parse(readFileSync(join(result.evidenceDir, "cases", "slow.json"), "utf8"));
  assert.equal(evidence.result.automatic, RESULT_RUNTIME_ERROR);
  assert.equal(evidence.runtime_error.category, "timeout");

  rmSync(tmp, { recursive: true, force: true });
});
