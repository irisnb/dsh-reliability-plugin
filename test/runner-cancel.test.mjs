// runner-cancel.test.mjs — runner 超时取消回归测试
// 覆盖评审阻塞项：
//   6) runner 超时后调用 adapter.cancelMessage（若存在），取消失败写入 trace，不留未处理请求
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runReliability, materialHash, RESULT_RUNTIME_ERROR } from "@dsh-reliability/core";

function makeCase(id) {
  const text = "林悦在城东的图书馆工作。";
  return {
    id,
    material: { name: "测试材料", version: "1", hash: materialHash(text), text },
    question: "问题？",
    expect: {
      factBoundary: { mustContain: ["城东的图书馆"], mustNegate: [] },
      wrongConclusions: [],
      allowedUncertainty: [],
      evidenceLocations: ["第一句"],
      riskTags: ["test"],
    },
  };
}

test("runner 超时后调用 adapter.cancelMessage", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-cancel-"));
  let cancelled = false;
  const adapter = {
    async start() {},
    async stop() {},
    async startSession() { return { id: "s" }; },
    async sendMessage() { return new Promise(() => {}); }, // 永不返回
    async cancelMessage() { cancelled = true; },
    async endSession() {},
  };

  try {
    await runReliability({
      cases: [makeCase("c")], adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r", timeoutMs: 50,
    });
  } finally {
    assert.equal(cancelled, true, "超时后应调用 cancelMessage");
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("取消失败写入 trace（request_failed / cancel_failed），不留未处理请求", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-cancel-fail-"));
  const events = [];
  const sink = { onEvent: (e) => events.push(e) };
  const adapter = {
    async start() {},
    async stop() {},
    async startSession() { return { id: "s" }; },
    async sendMessage() { return new Promise(() => {}); },
    async cancelMessage() { throw new Error("取消失败"); },
    async endSession() {},
  };

  try {
    const result = await runReliability({
      cases: [makeCase("c")], adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r", timeoutMs: 50, sink,
    });

    assert.equal(result.counts.runtime_error, 1, "超时仍是运行错误");
    const cancelFail = events.find((e) => e.kind === "request_failed" && e.meta?.code === "cancel_failed");
    assert.ok(cancelFail, "取消失败应写入 trace（request_failed/cancel_failed）");

    const evidence = JSON.parse(readFileSync(join(result.evidenceDir, "cases", "c.json"), "utf8"));
    assert.equal(evidence.result.automatic, RESULT_RUNTIME_ERROR);
    assert.equal(evidence.runtime_error.category, "timeout");
    assert.ok(evidence.trace.events.some((e) => e.meta?.code === "cancel_failed"), "证据 trace 含取消失败事件");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
