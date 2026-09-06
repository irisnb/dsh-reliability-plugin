// index.mjs — @dsh-reliability/core 公共 API
// 稳定接口：loadCases / screenAnswer / createEvidenceStore / runReliability / MockAdapter /
// RestApiAdapter / DriverAdapter 以及四态结果常量、脱敏工具、安全路径校验与证据构建函数。
export {
  loadCases,
  loadCasesFromFiles,
  resolveCaseFiles,
} from "./cases.mjs";

export {
  materialHash,
  validateCase,
  parseCaseSource,
} from "./schema.mjs";

export {
  screenAnswer,
  classifyPhrase,
  classifyPhraseOccurrences,
  detectUncertainty,
  RESULT_PASS_LIKELY,
  RESULT_FAIL_LIKELY,
  RESULT_NEEDS_REVIEW,
  RESULT_RUNTIME_ERROR,
  ALL_RESULTS,
  REVIEW_OUTCOMES,
} from "./screening.mjs";

export {
  buildEvidenceRecord,
  apiBaseLabel,
  evidenceOutputPath,
  TESTER_VERSION,
  EVIDENCE_SCHEMA_VERSION,
} from "./evidence.mjs";

export {
  createEvidenceStore,
} from "./evidence-store.mjs";

export {
  secretsFromEnv,
  redactSecrets,
  redactObject,
  findSecretLeaks,
  assertNoSecrets,
} from "./redact.mjs";

export {
  runReliability,
  normalizeScreen,
  buildRunSummary,
  renderReportHtml,
  defaultRunId,
} from "./runner.mjs";

export { buildSeedTurns } from "./seed.mjs";
export { MockAdapter } from "./mock-adapter.mjs";
export { RestApiAdapter } from "./rest-adapter.mjs";
export { DriverAdapter } from "./driver-adapter.mjs";
export { DriverClient } from "./driver-client.mjs";

export {
  isSafeFilenameId,
  assertSafeRunId,
  assertSafeCaseId,
  assertSafeCaseIds,
} from "./ids.mjs";
