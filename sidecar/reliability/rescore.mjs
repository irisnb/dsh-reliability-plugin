// rescore.mjs — 离线重评已保存证据（change: fix-screener-residual-defects 任务 3.1）
//
// 目的：不花 API 钱，用当前 screenAnswer 重评已保存证据的 response.text + 对应案例 expect，
// 验证评分器修复效果（design D7）。只读、无网络、不写证据、不改案例、不碰生产 driver。
//
// 用法：
//   node sidecar/reliability/rescore.mjs
//   node sidecar/reliability/rescore.mjs --evidence <dir> --fixtures <dir> --oracle <dir> --run <id>
//
// 默认路径（相对本文件）：
//   evidence = sidecar/reliability/evidence
//   fixtures = sidecar/reliability/fixtures
//   oracle   = sidecar/reliability/long-context/oracle
//
// 输出：每个运行档（evidence 一级子目录）的四态分布 + 逐条旧→新变化，最后总体分布。
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  screenAnswer,
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
} from "./screening.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_EVIDENCE_DIR = join(__dirname, "evidence");
const DEFAULT_FIXTURES_DIR = join(__dirname, "fixtures");
const DEFAULT_ORACLE_DIR = join(__dirname, "long-context", "oracle");

// 结果字符串 → 计数键。只统计四态；找不到 expect 单独计 missing_oracle，不进四态。
const RESULT_KEYS = {
  [RESULT_PASS_LIKELY]: "pass_likely",
  [RESULT_FAIL_LIKELY]: "fail_likely",
  [RESULT_NEEDS_REVIEW]: "needs_review",
  [RESULT_RUNTIME_ERROR]: "runtime_error",
};

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

function listJsonFiles(dir) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => extname(n).toLowerCase() === ".json")
    .sort();
}

function emptyCounts() {
  return { total: 0, pass_likely: 0, fail_likely: 0, needs_review: 0, runtime_error: 0, missing_oracle: 0, changed: 0 };
}

/**
 * 构建 case_id → expect 索引。fixtures 目录下每个 *.json 是一个案例（含 id/expect）；
 * long-context oracle 目录下每个 *.json 含 queries[]（每个含 id/expect）。返回 Map。
 */
export function buildExpectIndex({ fixturesDir, oracleDir }) {
  const index = new Map();
  for (const name of listJsonFiles(fixturesDir)) {
    const obj = readJson(join(fixturesDir, name));
    if (obj && typeof obj === "object" && typeof obj.id === "string" && obj.expect) {
      index.set(obj.id, obj.expect);
    }
  }
  for (const name of listJsonFiles(oracleDir)) {
    const obj = readJson(join(oracleDir, name));
    if (obj && Array.isArray(obj.queries)) {
      for (const q of obj.queries) {
        if (q && typeof q.id === "string" && q.expect) {
          index.set(q.id, q.expect);
        }
      }
    }
  }
  return index;
}

/**
 * 对单条证据记录重评。返回 { caseId, old, next, matched, runtimeError }。
 *   old    = 证据里保存的原结果（automatic + reasons）
 *   next   = 用当前 screenAnswer 重评的结果；找不到 expect 时为 null
 *   matched= 是否在索引中找到对应 expect
 *   runtimeError = 证据 runtime_error 非空（操作失败，保持 RUNTIME_ERROR，不把空回答重评成 FAIL_LIKELY）
 */
export function rescoreRecord(record, expectIndex) {
  const caseId = record?.case_id ?? null;
  const old = {
    automatic: record?.result?.automatic ?? null,
    reasons: Array.isArray(record?.result?.reasons) ? record.result.reasons : [],
  };

  if (record?.runtime_error) {
    return { caseId, old, next: { automatic: RESULT_RUNTIME_ERROR, reasons: old.reasons }, matched: true, runtimeError: true };
  }

  const expect = expectIndex.get(caseId);
  if (!expect) {
    return { caseId, old, next: null, matched: false, runtimeError: false };
  }

  const text = typeof record?.response?.text === "string" ? record.response.text : "";
  const scr = screenAnswer(expect, text);
  return { caseId, old, next: { automatic: scr.result, reasons: scr.reasons }, matched: true, runtimeError: false };
}

/**
 * 扫描证据目录：每个一级子目录视为一次运行（档），读取其 cases/*.json 证据记录。
 * 返回 [{ runId, records }]；runId 取目录名，跳过无 cases/ 子目录的目录。
 */
export function scanEvidenceRuns(evidenceDir) {
  if (!evidenceDir || !existsSync(evidenceDir)) return [];
  return readdirSync(evidenceDir)
    .filter((name) => {
      const p = join(evidenceDir, name);
      return statSync(p).isDirectory() && existsSync(join(p, "cases"));
    })
    .sort()
    .map((name) => {
      const casesDir = join(evidenceDir, name, "cases");
      const records = listJsonFiles(casesDir).map((n) => readJson(join(casesDir, n)));
      return { runId: name, records };
    });
}

function summarize(entries) {
  const counts = emptyCounts();
  for (const e of entries) {
    counts.total += 1;
    if (e.next) {
      const key = RESULT_KEYS[e.next.automatic];
      if (key) counts[key] += 1;
      else counts.missing_oracle += 1;
    } else {
      counts.missing_oracle += 1;
    }
    if (e.matched && e.next && e.old.automatic !== e.next.automatic) counts.changed += 1;
  }
  return counts;
}

/**
 * 完整离线重评：构建 expect 索引 → 扫描证据 → 逐条重评 → 聚合每档与总体分布。
 * 纯读取，无网络、无写入。返回 { runs, overall }；runFilter 可选，只处理指定 runId。
 */
export function rescoreAll({ evidenceDir, fixturesDir, oracleDir, runFilter } = {}) {
  const expectIndex = buildExpectIndex({ fixturesDir, oracleDir });
  const runs = scanEvidenceRuns(evidenceDir)
    .filter((r) => !runFilter || r.runId === runFilter)
    .map((r) => {
      const entries = r.records.map((rec) => rescoreRecord(rec, expectIndex));
      return { runId: r.runId, entries, counts: summarize(entries) };
    });

  return { runs, overall: summarize(runs.flatMap((r) => r.entries)) };
}

function parseArgs(argv) {
  const out = { evidenceDir: null, fixturesDir: null, oracleDir: null, run: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--evidence") out.evidenceDir = argv[++i];
    else if (a === "--fixtures") out.fixturesDir = argv[++i];
    else if (a === "--oracle") out.oracleDir = argv[++i];
    else if (a === "--run") out.run = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printCounts(label, c) {
  return `${label} total=${c.total} pass_likely=${c.pass_likely} fail_likely=${c.fail_likely} needs_review=${c.needs_review} runtime_error=${c.runtime_error} missing_oracle=${c.missing_oracle} changed=${c.changed}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法：node sidecar/reliability/rescore.mjs [--evidence <dir>] [--fixtures <dir>] [--oracle <dir>] [--run <id>]");
    console.log("默认扫描 sidecar/reliability/evidence，用当前 screenAnswer 离线重评已保存证据，不发网络请求。");
    return;
  }

  const evidenceDir = args.evidenceDir ?? DEFAULT_EVIDENCE_DIR;
  const fixturesDir = args.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const oracleDir = args.oracleDir ?? DEFAULT_ORACLE_DIR;

  if (!existsSync(evidenceDir)) {
    console.error(`证据目录不存在：${evidenceDir}`);
    process.exitCode = 2;
    return;
  }

  const res = rescoreAll({ evidenceDir, fixturesDir, oracleDir, runFilter: args.run });

  for (const run of res.runs) {
    console.log(printCounts(`RUN ${run.runId}:`, run.counts));
    for (const e of run.entries) {
      const from = e.old.automatic ?? "-";
      const to = e.next ? e.next.automatic : "MISSING_ORACLE";
      const mark = from === to ? " " : ">";
      console.log(`  [${from}${mark}${to}] ${e.caseId}`);
    }
    console.log("");
  }
  console.log(printCounts("OVERALL:", res.overall));
}

// 仅当作为入口脚本直接执行时运行 main()；被测试 import 时不执行（避免触发 parseArgs/process.exit）。
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
