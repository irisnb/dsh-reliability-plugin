// run.mjs — 运行测试（dsh-reliability-plugin）
// mock 模式离线运行（默认）；real 模式经真实 JSONL DSH 驱动（DriverAdapter，需 --driver/DSH_DRIVER_PATH）；
// api 模式是 OpenAI 兼容 REST API 测试器（RestApiAdapter，非 DSH 测试）。密钥只从 DEEPSEEK_API_KEY 读。
import { runReliability, MockAdapter, RestApiAdapter, DriverAdapter, loadCasesFromFiles } from "@dsh-reliability/core";
import { loadConfig, resolveCasesPath, resolveOutputDir, UsageError } from "../config.mjs";
import { EXIT_OK, EXIT_FAILURE, EXIT_USAGE, info, warn, error, printRunSummary } from "../output.mjs";

const VALUE_FLAGS = new Set(["--mode", "--model", "--cases", "--out", "--api-base", "--run-id", "--driver"]);

export function parseRunArgs(argv) {
  const out = { mode: null, model: null, cases: null, outDir: null, apiBase: null, runId: null, driver: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
      continue;
    }
    if (VALUE_FLAGS.has(a)) {
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("--")) {
        throw new UsageError(`选项 ${a} 缺少值`);
      }
      if (a === "--mode") out.mode = value;
      else if (a === "--model") out.model = value;
      else if (a === "--cases") out.cases = value;
      else if (a === "--out") out.outDir = value;
      else if (a === "--api-base") out.apiBase = value;
      else if (a === "--run-id") out.runId = value;
      else if (a === "--driver") out.driver = value;
      i++;
      continue;
    }
    throw new UsageError(`未知参数：${a}`);
  }
  return out;
}

export async function runCommand(argv, cwd = process.cwd()) {
  let args;
  let cfg;
  try {
    args = parseRunArgs(argv);
    cfg = loadConfig(cwd);
  } catch (err) {
    if (err instanceof UsageError) {
      error(err.message);
      return EXIT_USAGE;
    }
    throw err;
  }

  const mode = args.mode ?? cfg.mode ?? "mock";
  const model = args.model ?? cfg.model;
  const apiBase = args.apiBase ?? cfg.apiBase;

  if (mode !== "mock" && mode !== "real" && mode !== "api") {
    error(`未知模式：${mode}（仅支持 mock / real / api）`);
    return EXIT_USAGE;
  }

  const apiKey = process.env.DEEPSEEK_API_KEY ?? null;
  if ((mode === "real" || mode === "api") && !apiKey) {
    error("真实测试需要 DEEPSEEK_API_KEY 环境变量。");
    error('请先设置：PowerShell 用 $env:DEEPSEEK_API_KEY = "你的密钥"，Unix 用 export DEEPSEEK_API_KEY=...');
    error("若只想离线验证，请使用：dsh-reliability run --mode mock");
    return EXIT_USAGE;
  }

  // real 模式 = 真实 DSH 驱动（JSONL），驱动脚本不在发布包内，必须显式指定。
  const driverPath = args.driver ?? cfg.driver ?? process.env.DSH_DRIVER_PATH;
  if (mode === "real" && !driverPath) {
    error("真实 DSH 测试需要驱动脚本路径：用 --driver <路径> 指定，或设置 DSH_DRIVER_PATH 环境变量。");
    error("若只有 DeepSeek API key 而没有 DSH 容器，请改用 --mode api（OpenAI 兼容 API 测试器，非 DSH 测试）。");
    return EXIT_USAGE;
  }

  const casesPath = resolveCasesPath(args.cases ?? cfg.cases, cwd);
  if (!casesPath) {
    error(`找不到案例路径：${args.cases ?? cfg.cases ?? "fixtures/basic.jsonl"}（已按 cwd、CLI 包根与仓库根查找）`);
    return EXIT_USAGE;
  }

  const { valid, invalid } = loadCasesFromFiles(casesPath);
  for (const inv of invalid) {
    warn(`案例校验失败（${inv.source ?? inv.case?.id ?? "未知来源"} #${inv.index}）：${(inv.errors ?? []).join("；")}`);
  }
  if (valid.length === 0) {
    error("没有可运行的合法案例，退出。");
    return EXIT_FAILURE;
  }

  const outputDir = resolveOutputDir(args.outDir ?? cfg.out, cwd);

  let adapter;
  if (mode === "real") {
    adapter = new DriverAdapter({ driverPath, apiKey, apiBase, model, home: process.env.DSH_HOME });
  } else if (mode === "api") {
    adapter = new RestApiAdapter({ apiKey, apiBase, model });
  } else {
    adapter = new MockAdapter({ defaultPolicy: "echo-material" });
  }

  let result;
  try {
    result = await runReliability({
      cases: valid.map((v) => v.case),
      adapter,
      model,
      apiBase,
      mode,
      outputDir,
      runId: args.runId ?? undefined,
      apiKey,
    });
  } catch (err) {
    // 运行级校验失败（如不安全 runId、重复/不安全 case id）转为中文 usage error，避免堆栈直出。
    error(err instanceof UsageError ? err.message : String(err?.message ?? err));
    return EXIT_USAGE;
  }

  printRunSummary(result);
  info(result.runtimeErrorCount > 0 ? "RUNNER: OPERATIONAL FAILURES PRESENT" : "RUNNER: COMPLETE");
  return result.runtimeErrorCount > 0 ? EXIT_FAILURE : EXIT_OK;
}
