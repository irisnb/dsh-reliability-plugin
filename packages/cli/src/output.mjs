// output.mjs — CLI 输出与退出码（dsh-reliability-plugin）
export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;

export function info(msg) {
  console.log(msg);
}

export function warn(msg) {
  console.error(`[警告] ${msg}`);
}

export function error(msg) {
  console.error(`[错误] ${msg}`);
}

/** 打印运行摘要（与 core buildRunSummary 的 counts 一致）。 */
export function printRunSummary({ runId, counts, evidenceDir, cases }) {
  info(`RUN_ID=${runId}`);
  for (const c of cases ?? []) {
    info(`[${c.result}] ${c.case_id} — ${(c.reasons ?? []).join("；")}`);
  }
  info(`SUMMARY total=${counts.total} pass_likely=${counts.pass_likely} fail_likely=${counts.fail_likely} needs_review=${counts.needs_review} runtime_error=${counts.runtime_error}`);
  info(`EVIDENCE_DIR=${evidenceDir}`);
}
