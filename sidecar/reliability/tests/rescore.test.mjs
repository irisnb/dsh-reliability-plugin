// rescore.test.mjs — 离线重评脚本的本地单元测试（change: fix-screener-residual-defects 任务 3.1）
//
// 覆盖：expect 索引构建（fixtures + long-context oracle）、单条证据重评、
// RUNTIME_ERROR 保留、缺失 oracle 标记、证据目录扫描与每档/总体分布聚合。
// 全部离线：临时目录内构造最小 fixtures/oracle/evidence，不发网络、不碰真实证据与生产数据。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildExpectIndex,
  rescoreRecord,
  scanEvidenceRuns,
  rescoreAll,
} from "../rescore.mjs";
import {
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
  ALL_RESULTS,
} from "../screening.mjs";

const REL_DIR = fileURLToPath(new URL("..", import.meta.url)); // sidecar/reliability/

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "rescore-test-"));
}

function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

// ── buildExpectIndex：索引 fixtures 与 long-context oracle ─────────────────────
test("buildExpectIndex 同时索引 fixtures 单案例与 oracle 查询", () => {
  const root = makeTmpDir();
  const fixturesDir = join(root, "fixtures");
  const oracleDir = join(root, "oracle");
  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(oracleDir, { recursive: true });

  const fixExpect = { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: ["城东的图书馆"], allowedUncertainty: [] };
  const oracleExpect = { factBoundary: { mustContain: ["盐镇"], mustNegate: [] }, wrongConclusions: ["出生在盐城"], allowedUncertainty: [] };
  writeJson(join(fixturesDir, "version-conflict-v2.json"), { id: "version-conflict-v2", expect: fixExpect });
  writeJson(join(oracleDir, "tier-10k.json"), { queries: [{ id: "lc-10k-01", expect: oracleExpect }] });

  const index = buildExpectIndex({ fixturesDir, oracleDir });
  assert.ok(index instanceof Map);
  assert.equal(index.size, 2);
  assert.deepEqual(index.get("version-conflict-v2"), fixExpect);
  assert.deepEqual(index.get("lc-10k-01"), oracleExpect);
  rmSync(root, { recursive: true, force: true });
});

test("buildExpectIndex 在目录缺失时返回空索引而不崩溃", () => {
  const root = makeTmpDir();
  const index = buildExpectIndex({ fixturesDir: join(root, "nope"), oracleDir: join(root, "also-nope") });
  assert.ok(index instanceof Map);
  assert.equal(index.size, 0);
  rmSync(root, { recursive: true, force: true });
});

// ── rescoreRecord：用当前 screenAnswer 重评 ───────────────────────────────────
test("rescoreRecord 用当前 screenAnswer 重评，产出与旧结果不同的新结果", () => {
  const index = new Map();
  const expect = { factBoundary: { mustContain: ["摄影工作室"], mustNegate: ["在印刷厂工作"] }, wrongConclusions: ["还在印刷厂"], allowedUncertainty: [] };
  index.set("lc-30k-11", expect);
  const record = {
    case_id: "lc-30k-11",
    response: { text: "根据材料内容，陆遥现在**不在**印刷厂工作。\n\n依据是第五章《换工作》中明确写道：\n\n> “陆遥原本在城北的印刷厂做排版，后来辞职去了云峰山下的摄影工作室。”" },
    result: { automatic: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：在印刷厂工作"] },
    runtime_error: null,
  };
  const r = rescoreRecord(record, index);
  assert.equal(r.matched, true);
  assert.equal(r.runtimeError, false);
  assert.equal(r.old.automatic, RESULT_FAIL_LIKELY);
  assert.equal(r.next.automatic, RESULT_PASS_LIKELY);
});

test("rescoreRecord 保留 RUNTIME_ERROR，不把空回答重评成 FAIL_LIKELY", () => {
  const index = new Map();
  index.set("case-x", { factBoundary: { mustContain: [], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] });
  const record = {
    case_id: "case-x",
    response: { text: "" },
    result: { automatic: RESULT_RUNTIME_ERROR, reasons: ["timeout: 超时"] },
    runtime_error: { category: "timeout", message: "超时" },
  };
  const r = rescoreRecord(record, index);
  assert.equal(r.runtimeError, true);
  assert.equal(r.next.automatic, RESULT_RUNTIME_ERROR);
  assert.notEqual(r.next.automatic, RESULT_FAIL_LIKELY);
});

test("rescoreRecord 对缺失 oracle 的案例标记未匹配，next 为 null", () => {
  const index = new Map();
  const record = {
    case_id: "unknown-case",
    response: { text: "某个回答" },
    result: { automatic: RESULT_PASS_LIKELY, reasons: [] },
    runtime_error: null,
  };
  const r = rescoreRecord(record, index);
  assert.equal(r.matched, false);
  assert.equal(r.next, null);
});

// ── scanEvidenceRuns：证据目录扫描 ────────────────────────────────────────────
test("scanEvidenceRuns 扫描每个运行的 cases 子目录", () => {
  const root = makeTmpDir();
  const evidenceDir = join(root, "evidence");
  mkdirSync(join(evidenceDir, "run-1", "cases"), { recursive: true });
  mkdirSync(join(evidenceDir, "run-2", "cases"), { recursive: true });
  mkdirSync(join(evidenceDir, "no-cases-dir")); // 无 cases 子目录，应被跳过
  writeJson(join(evidenceDir, "run-1", "cases", "a.json"), { case_id: "a" });
  writeJson(join(evidenceDir, "run-2", "cases", "b.json"), { case_id: "b" });

  const runs = scanEvidenceRuns(evidenceDir);
  assert.deepEqual(runs.map((r) => r.runId), ["run-1", "run-2"]);
  assert.equal(runs[0].records[0].case_id, "a");
  assert.equal(runs[1].records[0].case_id, "b");
  rmSync(root, { recursive: true, force: true });
});

test("scanEvidenceRuns 对缺失目录返回空数组", () => {
  assert.deepEqual(scanEvidenceRuns(join(makeTmpDir(), "missing")), []);
});

// ── rescoreAll：端到端聚合每档与总体分布 ──────────────────────────────────────
test("rescoreAll 输出每档与总体四态分布、缺失 oracle 计数与变更计数", () => {
  const root = makeTmpDir();
  const fixturesDir = join(root, "fixtures");
  const oracleDir = join(root, "oracle");
  const evidenceDir = join(root, "evidence");
  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(oracleDir, { recursive: true });

  writeJson(join(fixturesDir, "case-a.json"), {
    id: "case-a",
    expect: { factBoundary: { mustContain: ["城西的画廊"], mustNegate: [] }, wrongConclusions: ["城东的图书馆"], allowedUncertainty: [] },
  });
  writeJson(join(oracleDir, "tier-10k.json"), {
    queries: [{ id: "lc-10k-01", expect: { factBoundary: { mustContain: ["盐镇"], mustNegate: [] }, wrongConclusions: [], allowedUncertainty: [] } }],
  });

  const run1 = join(evidenceDir, "run-1");
  mkdirSync(join(run1, "cases"), { recursive: true });
  writeJson(join(run1, "cases", "case-a.json"), {
    case_id: "case-a",
    response: { text: "林悦在城西的画廊上班。" },
    result: { automatic: RESULT_FAIL_LIKELY, reasons: ["断言了明确错误结论：城东的图书馆"] },
    runtime_error: null,
  });
  writeJson(join(run1, "cases", "case-z.json"), {
    case_id: "case-z",
    response: { text: "某个回答" },
    result: { automatic: RESULT_PASS_LIKELY, reasons: [] },
    runtime_error: null,
  });

  const run2 = join(evidenceDir, "run-2");
  mkdirSync(join(run2, "cases"), { recursive: true });
  writeJson(join(run2, "cases", "lc-10k-01.json"), {
    case_id: "lc-10k-01",
    response: { text: "苏晚出生在盐镇。" },
    result: { automatic: RESULT_NEEDS_REVIEW, reasons: [] },
    runtime_error: null,
  });

  const res = rescoreAll({ evidenceDir, fixturesDir, oracleDir });

  assert.equal(res.runs.length, 2);
  const byId = Object.fromEntries(res.runs.map((r) => [r.runId, r]));
  assert.deepEqual(byId["run-1"].counts, {
    total: 2, pass_likely: 1, fail_likely: 0, needs_review: 0, runtime_error: 0, missing_oracle: 1, changed: 1,
  });
  assert.deepEqual(byId["run-2"].counts, {
    total: 1, pass_likely: 1, fail_likely: 0, needs_review: 0, runtime_error: 0, missing_oracle: 0, changed: 1,
  });
  assert.equal(res.overall.total, 3);
  assert.equal(res.overall.pass_likely, 2);
  assert.equal(res.overall.missing_oracle, 1);
  assert.equal(res.overall.changed, 2);
  // 总体守恒：四态 + 缺失 = total
  assert.equal(
    res.overall.total,
    res.overall.pass_likely + res.overall.fail_likely + res.overall.needs_review + res.overall.runtime_error + res.overall.missing_oracle
  );
  rmSync(root, { recursive: true, force: true });
});

// ── 集成：真实证据目录可被默认路径扫描并重评（存在则断言，缺失则跳过）──────────────
test("集成：默认 evidence/fixtures/oracle 目录可被重评并产出四态分布", (t) => {
  const evidenceDir = join(REL_DIR, "evidence");
  if (!existsSync(evidenceDir)) return t.skip("无证据目录，跳过集成测试");

  const res = rescoreAll({
    evidenceDir,
    fixturesDir: join(REL_DIR, "fixtures"),
    oracleDir: join(REL_DIR, "long-context", "oracle"),
  });

  assert.ok(res.runs.length > 0, "应至少扫描到一个运行档");
  assert.ok(res.overall.total > 0, "总证据数应大于 0");

  for (const run of res.runs) {
    for (const e of run.entries) {
      if (e.matched) {
        assert.ok(ALL_RESULTS.includes(e.next.automatic), `重评结果应为四态之一，得到 ${e.next.automatic}（${e.caseId}）`);
      } else {
        assert.equal(e.next, null);
      }
    }
  }
  // 每档计数守恒
  for (const run of res.runs) {
    const c = run.counts;
    assert.equal(c.total, c.pass_likely + c.fail_likely + c.needs_review + c.runtime_error + c.missing_oracle);
  }
});
