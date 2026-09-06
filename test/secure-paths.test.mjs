// secure-paths.test.mjs — 安全路径回归测试
// 覆盖评审阻塞项：
//   2) 限制 runId/caseId 为安全文件名，拒绝路径穿越与重复 case id，输出目录不被越界
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runReliability,
  createEvidenceStore,
  MockAdapter,
  materialHash,
} from "@dsh-reliability/core";

function makeCase(id, text = "林悦在城东的图书馆工作。") {
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

test("runId 拒绝路径穿越，不写出输出目录", async () => {
  const base = mkdtempSync(join(tmpdir(), "dsh-sec-base-"));
  const outputDir = join(base, "out");
  mkdirSync(outputDir, { recursive: true });
  try {
    const cases = [makeCase("safe")];
    const adapter = new MockAdapter({ responses: { safe: "林悦在城东的图书馆工作。" } });
    await assert.rejects(
      () => runReliability({ cases, adapter, model: "m", mode: "mock", outputDir, runId: "../escape" }),
      /runId/,
    );
    await assert.rejects(
      () => runReliability({ cases, adapter, model: "m", mode: "mock", outputDir, runId: "a/b" }),
      /runId/,
    );
    // 无越界产物：base 下不得出现 escape 目录，outputDir 保持为空
    assert.ok(!existsSync(join(base, "escape")), "不得在输出目录之外写入");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("caseId 拒绝路径穿越与空值", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-sec-case-"));
  try {
    const adapter = new MockAdapter();
    for (const badId of ["../evil", "a\\b", "", "..", ".hidden"]) {
      const cases = [makeCase(badId)];
      await assert.rejects(
        () => runReliability({ cases, adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r" }),
        /案例 id|caseId|case/i,
        `应拒绝 caseId=${JSON.stringify(badId)}`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("重复 case id 被拒绝", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-sec-dup-"));
  try {
    const adapter = new MockAdapter();
    const cases = [makeCase("dup"), makeCase("dup")];
    await assert.rejects(
      () => runReliability({ cases, adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r" }),
      /重复/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("createEvidenceStore 的 writeCase 拒绝不安全 caseId", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-sec-store-"));
  try {
    const store = createEvidenceStore({ outputDir: tmp, runId: "r", apiKey: null });
    assert.throws(() => store.writeCase("../evil", {}), /案例 id|caseId/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
