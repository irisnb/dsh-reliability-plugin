// config.mjs — CLI 配置与路径解析（dsh-reliability-plugin）
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// CLI 包根：packages/cli
export const CLI_ROOT = resolve(__dirname, "..");
// 仓库根（fixtures/ 所在）：packages/cli/../../
export const REPO_ROOT = resolve(CLI_ROOT, "..", "..");

export const DEFAULT_CONFIG = {
  model: "deepseek-v4-pro",
  mode: "mock",
  cases: "fixtures/basic.jsonl",
  out: "artifacts/runs",
  apiBase: "https://api.deepseek.com",
  driver: null,
};

export const CONFIG_FILENAME = "dsh-reliability.config.json";

/** 用法/配置错误：CLI 捕获后转为 EXIT_USAGE 并打印中文信息。 */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export function configPath(cwd = process.cwd()) {
  return join(cwd, CONFIG_FILENAME);
}

/** 校验配置字段类型与值域。返回人类可读错误数组（空 = 通过）。 */
export function validateConfig(config) {
  const errors = [];
  if (typeof config.model !== "string" || config.model.trim() === "") {
    errors.push("model 必须是非空字符串");
  }
  if (!["mock", "real", "api"].includes(config.mode)) {
    errors.push(`mode 必须是 mock / real / api 之一（当前：${JSON.stringify(config.mode)}）`);
  }
  if (typeof config.cases !== "string" || config.cases.trim() === "") {
    errors.push("cases 必须是非空字符串");
  }
  if (typeof config.out !== "string" || config.out.trim() === "") {
    errors.push("out 必须是非空字符串");
  }
  if (typeof config.apiBase !== "string" || config.apiBase.trim() === "") {
    errors.push("apiBase 必须是非空字符串");
  } else {
    try {
      // eslint-disable-next-line no-new
      new URL(config.apiBase);
    } catch {
      errors.push("apiBase 必须是合法 URL（含协议，如 https://api.deepseek.com）");
    }
  }
  if (config.driver != null && typeof config.driver !== "string") {
    errors.push("driver 必须是字符串或 null");
  }
  return errors;
}

/**
 * 读取 cwd 下的配置；不存在时返回默认值。
 * 解析失败或字段类型/值域非法时抛出 UsageError（fail-fast，不静默回退）。
 */
export function loadConfig(cwd = process.cwd()) {
  const p = configPath(cwd);
  if (!existsSync(p)) return { ...DEFAULT_CONFIG };

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, "utf8"));
  } catch (err) {
    throw new UsageError(`配置文件解析失败：${p}（${String(err?.message ?? err)}）`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`配置文件格式无效：${p}（应为 JSON 对象）`);
  }
  const merged = { ...DEFAULT_CONFIG, ...parsed };
  const errors = validateConfig(merged);
  if (errors.length > 0) {
    throw new UsageError(`配置无效（${p}）：\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
  return merged;
}

/**
 * 解析案例路径（--cases 或配置里的 cases，默认 fixtures/basic.jsonl）。
 * 相对路径先按 cwd 解析，再按 CLI 包根（含打包后的默认 fixture），最后按仓库根回退；找不到返回 null。
 * 这样 npm 安装后的 CLI 也能找到包内自带的默认 fixture，而不依赖仓库根或尚未发布的 registry 包。
 */
export function resolveCasesPath(arg, cwd = process.cwd()) {
  const cases = arg || DEFAULT_CONFIG.cases;
  const candidates = [];
  if (isAbsolute(cases)) {
    candidates.push(cases);
  } else {
    candidates.push(resolve(cwd, cases));
    candidates.push(resolve(CLI_ROOT, cases));
    candidates.push(resolve(REPO_ROOT, cases));
  }
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function isAbsolute(p) {
  return /^([a-zA-Z]:[\\/]|[\\/])/.test(p);
}

/** 解析输出目录（相对路径按 cwd）。 */
export function resolveOutputDir(arg, cwd = process.cwd()) {
  const p = arg || DEFAULT_CONFIG.out;
  return isAbsolute(p) ? p : resolve(cwd, p);
}
