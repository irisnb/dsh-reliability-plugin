// evidence-store.mjs — 证据落盘存储（@dsh-reliability/core）
// 负责把证据/汇总写入独立运行目录并做密钥脱敏 + 落盘前泄漏复核。不修改 evidence.mjs 的镜像。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TESTER_VERSION, EVIDENCE_SCHEMA_VERSION } from "./evidence.mjs";
import { secretsFromEnv, redactObject, assertNoSecrets } from "./redact.mjs";
import { renderReportHtml } from "./report.mjs";
import { assertSafeRunId, assertSafeCaseId } from "./ids.mjs";

/**
 * 创建证据存储。每次调用对应一次独立运行，输出目录为 <outputDir>/<runId>/。
 * 返回 { runDir, writeCase, writeManifest, writeReport, writeReportHtml, secrets }。
 * 所有 JSON 落盘前经 redactObject 脱敏，落盘后 assertNoSecrets 复核，结果写入 secret_check 字段。
 */
export function createEvidenceStore({ outputDir, runId, apiKey }) {
  assertSafeRunId(runId);
  const secrets = secretsFromEnv(apiKey);
  const runDir = join(outputDir, runId);
  mkdirSync(runDir, { recursive: true });

  const writeRedactedJson = (relPath, obj) => {
    const redacted = redactObject(obj, secrets);
    const leakCheck = assertNoSecrets(JSON.stringify(redacted), secrets);
    redacted.secret_check = { passed: leakCheck.ok, leaks: leakCheck.leaks };
    writeFileSync(join(runDir, relPath), JSON.stringify(redacted, null, 2) + "\n", "utf8");
    return { passed: leakCheck.ok, leaks: leakCheck.leaks };
  };

  return {
    runDir,
    secrets,
    /** 写入 <runDir>/cases/<caseId>.json，返回脱敏检查结果。 */
    writeCase(caseId, evidenceRecord) {
      assertSafeCaseId(caseId);
      const casesDir = join(runDir, "cases");
      mkdirSync(casesDir, { recursive: true });
      return writeRedactedJson(join("cases", `${caseId}.json`), evidenceRecord);
    },
    writeManifest(manifest) {
      return writeRedactedJson("manifest.json", manifest);
    },
    writeReport(report) {
      return writeRedactedJson("report.json", report);
    },
    /** 渲染 report.html 前先对报告对象做脱敏，保证 HTML 与 JSON 使用同一份脱敏数据（任何理由/错误文本含 key 也不泄漏）。 */
    writeReportHtml(report) {
      const redacted = redactObject(report, secrets);
      writeFileSync(join(runDir, "report.html"), renderReportHtml(redacted), "utf8");
    },
  };
}

export { TESTER_VERSION, EVIDENCE_SCHEMA_VERSION };
