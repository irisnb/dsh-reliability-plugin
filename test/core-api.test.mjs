// core-api.test.mjs — core 稳定接口测试：loadCases / screenAnswer / createEvidenceStore / runReliability，
// 覆盖四种结果状态、运行错误与密钥脱敏，并做与 sidecar 评分规则的一致性守门。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadCases,
  screenAnswer,
  createEvidenceStore,
  runReliability,
  MockAdapter,
  materialHash,
  redactObject,
  assertNoSecrets,
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
} from "@dsh-reliability/core";

function makeCase(id, { text, mustContain = [], mustNegate = [], wrongConclusions = [], allowedUncertainty = [], question = "问题？" } = {}) {
  return {
    id,
    material: { name: "测试材料", version: "1", hash: materialHash(text), text },
    question,
    expect: {
      factBoundary: { mustContain, mustNegate },
      wrongConclusions,
      allowedUncertainty,
      evidenceLocations: ["第一句"],
      riskTags: ["test"],
    },
  };
}

test("loadCases 校验合法案例并拒绝结构不完整案例", () => {
  const good = makeCase("good", { text: "林悦在城东的图书馆工作。" });
  const { valid, invalid, parseError } = loadCases(JSON.stringify([good]));
  assert.equal(parseError, null);
  assert.equal(valid.length, 1);
  assert.equal(invalid.length, 0);

  const bad = { id: "bad", material: { name: "x", version: "1", hash: "sha256:deadbeef", text: "t" }, question: "q", expect: {} };
  const r2 = loadCases([bad]);
  assert.equal(r2.valid.length, 0);
  assert.equal(r2.invalid.length, 1);
  assert.ok(r2.invalid[0].errors.length > 0);
});

test("loadCases 支持 JSONL 并报告解析错误", () => {
  const a = makeCase("a", { text: "材料A" });
  const b = makeCase("b", { text: "材料B" });
  const jsonl = JSON.stringify(a) + "\n" + JSON.stringify(b) + "\n";
  const r = loadCases(jsonl);
  assert.equal(r.valid.length, 2);

  const broken = '{"id": "x",\n';
  const r2 = loadCases(broken);
  assert.equal(r2.valid.length, 0);
  assert.ok(r2.parseError, "解析错误应被报告");
});

test("screenAnswer 覆盖四种结果状态", () => {
  const expect = {
    factBoundary: { mustContain: ["城东的图书馆"], mustNegate: [] },
    wrongConclusions: ["城西的画廊"],
    allowedUncertainty: [],
  };
  assert.equal(screenAnswer(expect, "林悦在城东的图书馆工作。").result, RESULT_PASS_LIKELY);
  assert.equal(screenAnswer(expect, "林悦在城西的画廊工作。").result, RESULT_FAIL_LIKELY);
  assert.equal(screenAnswer(expect, "林悦是一名设计师。").result, RESULT_NEEDS_REVIEW);
  assert.equal(screenAnswer(expect, "   ").result, RESULT_FAIL_LIKELY);
});

test("redactObject / assertNoSecrets 密钥脱敏", () => {
  const key = "sk-secret-key-12345678";
  const obj = { a: `token=${key}`, nested: { b: key } };
  const redacted = redactObject(obj, [key]);
  assert.equal(redacted.a, "token=[REDACTED]");
  assert.equal(redacted.nested.b, "[REDACTED]");
  assert.deepEqual(assertNoSecrets(JSON.stringify(redacted), [key]), { ok: true, leaks: [] });
});

test("createEvidenceStore 脱敏写入案例证据", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-core-"));
  const key = "sk-abc123456789";
  const store = createEvidenceStore({ outputDir: tmp, runId: "r1", apiKey: key });
  const res = store.writeCase("c1", { run_id: "r1", leak: key });
  assert.equal(res.passed, true);
  const content = readFileSync(join(tmp, "r1", "cases", "c1.json"), "utf8");
  assert.ok(!content.includes(key), "密钥不得落盘");
  assert.ok(content.includes("[REDACTED]"));
  rmSync(tmp, { recursive: true, force: true });
});

test("runReliability 用 MockAdapter 产出 manifest/report/report.html/cases 并正确计数", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-run-"));

  const cases = [
    makeCase("pass", { text: "材料一", mustContain: ["城东的图书馆"] }),
    makeCase("fail", { text: "材料二", wrongConclusions: ["城西的画廊"] }),
    makeCase("review", { text: "材料三", mustContain: ["开了一间茶馆"] }),
    makeCase("runtime", { text: "材料四" }),
  ];

  const adapter = new MockAdapter({
    responses: {
      pass: "林悦在城东的图书馆工作。",
      fail: "林悦在城西的画廊工作。",
      review: "林悦是一名平面设计师。",
    },
    errors: {
      runtime: { category: "timeout", message: "请求超时" },
    },
  });

  const result = await runReliability({
    cases,
    adapter,
    model: "mock-model",
    apiBase: "https://example.invalid",
    mode: "mock",
    outputDir: tmp,
    runId: "fixed-run",
  });

  assert.deepEqual(result.counts, { total: 4, pass_likely: 1, fail_likely: 1, needs_review: 1, runtime_error: 1 });
  assert.equal(result.runtimeErrorCount, 1);

  const runDir = join(tmp, "fixed-run");
  assert.ok(existsSync(join(runDir, "manifest.json")));
  assert.ok(existsSync(join(runDir, "report.json")));
  assert.ok(existsSync(join(runDir, "report.html")));
  const caseFiles = readdirSync(join(runDir, "cases")).sort();
  assert.deepEqual(caseFiles, ["fail.json", "pass.json", "review.json", "runtime.json"]);

  const manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  assert.equal(manifest.counts.total, 4);
  const runtimeCase = JSON.parse(readFileSync(join(runDir, "cases", "runtime.json"), "utf8"));
  assert.equal(runtimeCase.result.automatic, RESULT_RUNTIME_ERROR);

  rmSync(tmp, { recursive: true, force: true });
});

test("runReliability 对失败运行的证据落盘不包含密钥", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-secret-"));
  const key = "sk-real-key-abcdefgh1234";
  const cases = [makeCase("s", { text: "材料", mustContain: ["事实"] })];
  const adapter = new MockAdapter({ responses: { s: `密钥是 ${key} 的事实` } });

  const result = await runReliability({
    cases, adapter, model: "m", mode: "mock", outputDir: tmp, runId: "r", apiKey: key,
  });

  const evidence = readFileSync(join(result.evidenceDir, "cases", "s.json"), "utf8");
  assert.ok(!evidence.includes(key), "响应中的密钥必须被脱敏");
  rmSync(tmp, { recursive: true, force: true });
});

test("一致性守门：core 评分与 sidecar 评分规则完全一致", async () => {
  const sidecar = await import(new URL("../sidecar/reliability/screening.mjs", import.meta.url));
  const pairs = [
    [{ factBoundary: { mustContain: ["城东的图书馆"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] }, "林悦在城东的图书馆工作。"],
    [{ factBoundary: { mustContain: ["城东的图书馆"], mustNegate: [] }, wrongConclusions: ["城西的画廊"], allowedUncertainty: [] }, "林悦在城西的画廊工作。"],
    [{ factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: ["未知", "未提及"] }, "材料未提及相关内容。"],
    [{ factBoundary: { mustContain: [], mustNegate: ["城东的图书馆"] }, wrongConclusions: [], allowedUncertainty: [] }, "林悦辞去了城东图书馆的工作。"],
    [{ factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] }, "   "],
  ];
  for (const [expect, answer] of pairs) {
    assert.deepEqual(screenAnswer(expect, answer), sidecar.screenAnswer(expect, answer), `answer=${answer}`);
  }
});
