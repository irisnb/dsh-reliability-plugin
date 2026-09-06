// runner.mjs — 运行编排（@dsh-reliability/core）
// 接收已校验案例 + DshAdapter，逐案例运行、保守初筛、脱敏落盘，输出 manifest/report/report.html/cases。
// 评分规则复用 screening.mjs（镜像），不在此处复制。
// 接收 ProbeSink/trace sink：逐案例合成会话/请求/增量/完成/失败事件写入 sink，并把事件写入每案例证据，
// 据此计算 protocol.delta_count（不固定为 0）与 event_summary。
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { screenAnswer, RESULT_RUNTIME_ERROR } from "./screening.mjs";
import { buildEvidenceRecord, apiBaseLabel, TESTER_VERSION, EVIDENCE_SCHEMA_VERSION } from "./evidence.mjs";
import { createEvidenceStore } from "./evidence-store.mjs";
import { buildSeedTurns } from "./seed.mjs";
import { renderReportHtml } from "./report.mjs";
import { assertSafeRunId, assertSafeCaseIds } from "./ids.mjs";

/** 默认运行标识（时间戳，确定性排序友好）。 */
export function defaultRunId() {
  return `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

/**
 * 归一化评分结果形状：screenAnswer 返回 { result, reasons }，运行错误分支构造 { automatic, reasons }。
 * 统一为 { automatic, reasons }。与 sidecar/reliability/runner.mjs 一致。
 */
export function normalizeScreen(scr) {
  if (scr && typeof scr === "object" && "result" in scr && !("automatic" in scr)) {
    return { automatic: scr.result, reasons: Array.isArray(scr.reasons) ? scr.reasons : [] };
  }
  return scr;
}

/**
 * 由逐案例结果构建汇总计数与条目（与 sidecar/reliability/runner.mjs 一致）。
 * @param {Array<{case_id, screen, evidence_file}>} caseEntries
 */
export function buildRunSummary(caseEntries) {
  const counts = { total: 0, pass_likely: 0, fail_likely: 0, needs_review: 0, runtime_error: 0 };
  const cases = [];
  for (const entry of caseEntries) {
    const screen = normalizeScreen(entry?.screen);
    const result = screen && typeof screen.automatic === "string" ? screen.automatic : null;
    counts.total += 1;
    if (result !== null) {
      const key = result.toLowerCase();
      if (counts[key] !== undefined) counts[key] += 1;
    }
    cases.push({
      case_id: entry?.case_id ?? null,
      result,
      reasons: screen?.reasons ?? [],
      evidence_file: entry?.evidence_file ?? null,
    });
  }
  return { counts, cases };
}

/** 进程内 trace sink 兜底：当调用方未提供 sink 时使用（与插件 ProbeSink 接口一致）。 */
function createTraceSink() {
  const buffer = [];
  return {
    onEvent(event) {
      if (event && typeof event === "object") buffer.push(event);
    },
    events() {
      return [...buffer];
    },
    async flush() {
      return buffer.splice(0, buffer.length);
    },
    clear() {
      buffer.length = 0;
    },
  };
}

/** 为单个 Promise 附加超时。超时抛出带 category="timeout" 的错误。 */
async function withTimeout(promise, ms, label) {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`${label} 超时（${ms}ms）`);
      err.category = "timeout";
      reject(err);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 把完整回答按固定块切分，模拟流式增量（真实流式由 driver 提供 delta 事件）。 */
function chunkText(text, size = 64) {
  const t = String(text ?? "");
  if (t === "") return [];
  const chunks = [];
  for (let i = 0; i < t.length; i += size) chunks.push(t.slice(i, i + size));
  return chunks;
}

/** 对单个案例走完整适配器协议：注入种子 → 前置步骤 → 最终问题，返回结构化运行结果（含 trace 事件）。 */
async function runOneCase(adapter, caseDef, defaultTimeoutMs, sink) {
  const caseId = caseDef.id;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const sessionId = `rel-${randomUUID()}`;
  const timeoutMs = caseDef.timeoutMs ?? defaultTimeoutMs;

  const seed = buildSeedTurns(caseDef.material);
  const steps = Array.isArray(caseDef.steps) ? caseDef.steps : [];

  const stepResults = [];
  const traceEvents = [];
  let runtimeError = null;
  let protocolOutcome = "completed";
  let terminalState = null;
  let finalText = "";
  let finalMessageId = null;

  let turn = 0;
  let seqCounter = 0;
  let msgCounter = 0;

  /** 合成一条 DshTraceEvent 并同时写入本地 trace 与外部 sink。 */
  const emit = (kind, { text = null, meta = null, messageId = null } = {}) => {
    const evt = {
      kind,
      sessionId,
      turnId: `turn-${turn}`,
      messageId: messageId ?? `msg-${sessionId}-${++msgCounter}`,
      seq: seqCounter++,
      text,
      meta,
      timestamp: Date.now(),
    };
    traceEvents.push(evt);
    if (sink && typeof sink.onEvent === "function") sink.onEvent(evt);
    return evt;
  };

  /** 按适配器响应合成增量/完成/失败事件，返回增量数。 */
  const emitResponseEvents = (resp) => {
    if (resp?.error) {
      emit("request_failed", { meta: { code: resp?.code ?? resp?.error?.category ?? null, message: resp?.message ?? resp?.error?.message ?? null } });
      return 0;
    }
    const chunks = chunkText(resp?.text);
    for (const c of chunks) emit("response_delta", { text: c });
    emit("response_complete", { text: resp?.text ?? "", messageId: resp?.messageId ?? null });
    return chunks.length;
  };

  /** 发送一轮；超时则尝试取消（adapter.cancelMessage 若存在），取消失败写入 trace。 */
  const sendTurn = async (text, messageId) => {
    const promise = adapter.sendMessage(session, text);
    try {
      return await withTimeout(promise, timeoutMs, "发送消息");
    } catch (err) {
      if (err?.category === "timeout" && typeof adapter.cancelMessage === "function") {
        try {
          await adapter.cancelMessage(session, messageId);
        } catch (cancelErr) {
          emit("request_failed", { meta: { code: "cancel_failed", message: String(cancelErr?.message ?? cancelErr) } });
        }
      }
      throw err;
    }
  };

  emit("session_started");

  let session = null;
  try {
    session = await adapter.startSession(seed, { caseId, material: caseDef.material });

    for (let i = 0; i < steps.length; i++) {
      turn += 1;
      const tStart = Date.now();
      emit("request_started", { text: steps[i].text, messageId: `step-${i}` });
      const resp = await sendTurn(steps[i].text, `step-${i}`);
      const deltaCount = emitResponseEvents(resp);
      stepResults.push({
        index: i,
        message_id: resp?.messageId ?? null,
        text: steps[i].text,
        terminal: resp?.terminal ?? "message_done",
        code: resp?.code ?? null,
        response_text: resp?.text ?? "",
        duration_ms: Date.now() - tStart,
        delta_count: deltaCount,
      });
    }

    turn += 1;
    emit("request_started", { text: caseDef.question, messageId: "final" });
    const finalResp = await sendTurn(caseDef.question, "final");
    emitResponseEvents(finalResp);

    terminalState = finalResp?.terminal ?? "message_done";
    finalText = finalResp?.text ?? "";
    finalMessageId = finalResp?.messageId ?? null;

    if (finalResp?.error) {
      runtimeError = finalResp.error;
      protocolOutcome = terminalState === "error" ? "protocol_error" : "message_failed";
    }
  } catch (err) {
    runtimeError = { category: err?.category ?? "protocol_error", message: String(err?.message ?? err) };
    protocolOutcome = err?.category ?? "protocol_error";
    if (!traceEvents.some((e) => e.kind === "request_failed")) {
      emit("request_failed", { meta: { code: runtimeError.category, message: runtimeError.message } });
    }
  } finally {
    if (session) {
      try { await adapter.endSession(session); } catch { /* 清理尽力而为 */ }
    }
  }

  const deltaCount = traceEvents.filter((e) => e.kind === "response_delta").length;
  const eventSummary = traceEvents.map((e) => e.kind);

  return {
    caseId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    protocol: {
      outcome: protocolOutcome,
      terminal_state: terminalState,
      delta_count: deltaCount,
      event_summary: eventSummary,
      session_id: sessionId,
      final_message_id: finalMessageId,
    },
    response: { text: finalText, steps: stepResults },
    trace: traceEvents,
    runtimeError,
  };
}

/**
 * 完整运行编排。返回 { runId, counts, evidenceDir, manifestPath, reportPath, reportHtmlPath, cases }。
 * @param {object} options
 * @param {object[]} options.cases 已校验案例
 * @param {object} options.adapter DshAdapter 实现
 * @param {string} options.model 模型标识
 * @param {string} [options.apiBase] 非敏感 API 端点
 * @param {"real"|"mock"} [options.mode] 运行模式
 * @param {string} options.outputDir 证据输出目录
 * @param {string} [options.runId] 运行标识（默认按时间戳生成）
 * @param {string} [options.apiKey] 仅用于脱敏（绝不落盘）
 * @param {number} [options.timeoutMs]
 * @param {object} [options.sink] ProbeSink / trace sink（可选，默认创建进程内 sink）
 */
export async function runReliability(options) {
  const {
    cases,
    adapter,
    model,
    apiBase = null,
    mode = "mock",
    outputDir,
    runId = defaultRunId(),
    apiKey = null,
    timeoutMs = 180000,
    sink = createTraceSink(),
  } = options;

  if (!Array.isArray(cases)) throw new TypeError("runReliability 需要 cases 数组");
  if (!adapter) throw new TypeError("runReliability 需要 adapter");
  if (!outputDir) throw new TypeError("runReliability 需要 outputDir");

  // 安全路径：runId 与每个 case.id 必须是安全文件名，且 case id 不得重复。
  assertSafeRunId(runId);
  assertSafeCaseIds(cases);

  const store = createEvidenceStore({ outputDir, runId, apiKey });
  const startedAt = new Date().toISOString();

  let adapterStartError = null;
  try {
    await adapter.start({ model, apiBase, mode });
  } catch (err) {
    adapterStartError = { category: err?.category ?? "adapter_start_failed", message: String(err?.message ?? err) };
  }

  const summaries = [];
  let runtimeErrorCount = 0;

  for (const caseDef of cases) {
    const caseStartedAt = new Date().toISOString();
    let run;
    let screen;

    if (adapterStartError) {
      run = {
        caseId: caseDef.id,
        startedAt: caseStartedAt,
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        protocol: { outcome: adapterStartError.category, terminal_state: null, delta_count: 0, event_summary: [], session_id: null, final_message_id: null },
        response: { text: "", steps: [] },
        trace: [],
        runtimeError: adapterStartError,
      };
      screen = { automatic: RESULT_RUNTIME_ERROR, reasons: [`${adapterStartError.category}: ${adapterStartError.message}`] };
      runtimeErrorCount++;
    } else {
      run = await runOneCase(adapter, caseDef, timeoutMs, sink);
      if (run.runtimeError) {
        screen = { automatic: RESULT_RUNTIME_ERROR, reasons: [`${run.runtimeError.category}: ${run.runtimeError.message}`] };
        runtimeErrorCount++;
      } else {
        screen = normalizeScreen(screenAnswer(caseDef.expect, run.response.text));
      }
    }

    const evidence = buildEvidenceRecord({
      runId,
      caseId: caseDef.id,
      material: caseDef.material,
      model,
      apiBaseLabel: apiBaseLabel(apiBase),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      steps: run.response.steps,
      question: caseDef.question,
      response: run.response,
      protocol: run.protocol,
      result: screen,
      runtimeError: run.runtimeError,
    });
    // 插件事件写入每案例证据（脱敏由 evidence-store 落盘前统一处理）
    evidence.trace = { events: run.trace ?? [] };

    const leak = store.writeCase(caseDef.id, evidence);
    if (!leak.passed) {
      screen.automatic = RESULT_RUNTIME_ERROR;
      screen.reasons.push("证据或诊断含密钥泄漏");
      runtimeErrorCount++;
    }

    summaries.push({ case_id: caseDef.id, screen, evidence_file: `cases/${caseDef.id}.json` });
  }

  try { await adapter.stop?.(); } catch { /* 忽略 */ }

  const finishedAt = new Date().toISOString();
  const { counts, cases: caseList } = buildRunSummary(summaries);

  const manifest = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    tester_version: TESTER_VERSION,
    run_id: runId,
    started_at: startedAt,
    finished_at: finishedAt,
    configuration: { model, api_base: apiBaseLabel(apiBase), mode },
    counts,
    cases: caseList,
  };
  store.writeManifest(manifest);

  const report = {
    schema_version: EVIDENCE_SCHEMA_VERSION,
    tester_version: TESTER_VERSION,
    run_id: runId,
    generated_at: finishedAt,
    configuration: { model, api_base: apiBaseLabel(apiBase), mode },
    counts,
    cases: caseList.map((c) => ({ ...c, human_review: null, reviewer_notes: null })),
  };
  store.writeReport(report);
  store.writeReportHtml(report);

  return {
    runId,
    counts,
    evidenceDir: store.runDir,
    manifestPath: join(store.runDir, "manifest.json"),
    reportPath: join(store.runDir, "report.json"),
    reportHtmlPath: join(store.runDir, "report.html"),
    cases: caseList,
    runtimeErrorCount,
  };
}

export { renderReportHtml };
