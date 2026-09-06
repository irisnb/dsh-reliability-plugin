// evidence-html.test.mjs — report.html 脱敏一致性回归测试
// 覆盖评审阻塞项：
//   5) report.html 必须使用与 JSON 一致的脱敏数据；任何理由/错误文本含 key 也不能泄漏
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runReliability, MockAdapter, materialHash } from "@dsh-reliability/core";

test("report.html 使用脱敏数据：理由文本含 key 不泄漏", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-html-"));
  const key = "sk-leak-key-1234567890";

  const cases = [{
    id: "leak",
    material: { name: "材料", version: "1", hash: materialHash("材料"), text: "材料" },
    question: "问题？",
    expect: {
      factBoundary: { mustContain: [], mustNegate: [] },
      wrongConclusions: [`答案是 ${key}`],
      allowedUncertainty: [],
      evidenceLocations: ["全文"],
      riskTags: ["test"],
    },
  }];
  // 模型断言了含 key 的错误结论 → 评分理由会带上该结论文本
  const adapter = new MockAdapter({ responses: { leak: `答案是 ${key}` } });

  const result = await runReliability({
    cases, adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r", apiKey: key,
  });

  const html = readFileSync(join(result.evidenceDir, "report.html"), "utf8");
  assert.ok(!html.includes(key), "report.html 不得含 key");
  assert.ok(html.includes("[REDACTED]"), "report.html 应含脱敏占位");

  const reportJson = readFileSync(join(result.evidenceDir, "report.json"), "utf8");
  assert.ok(!reportJson.includes(key), "report.json 不得含 key");

  rmSync(tmp, { recursive: true, force: true });
});
