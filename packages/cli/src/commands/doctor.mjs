// doctor.mjs — 环境自检（dsh-reliability-plugin）
// 检查 Node.js、依赖、插件版本、DSH 兼容版本、配置、API key 状态与夹具/输出。
// 离线模式不因缺少 API key 失败。返回 EXIT_OK 或 EXIT_FAILURE。
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { configPath, resolveCasesPath, resolveOutputDir, loadConfig, DEFAULT_CONFIG } from "../config.mjs";
import { EXIT_OK, EXIT_FAILURE, info, warn } from "../output.mjs";

function readPkgVersion(p) {
  try {
    const v = JSON.parse(readFileSync(p, "utf8")).version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** 通过 Node 包解析定位已安装包的 package.json（不依赖仓库根路径）。 */
function resolvePackageJson(specifier) {
  try {
    const req = createRequire(import.meta.url);
    const entry = req.resolve(specifier);
    let dir = dirname(entry);
    for (let i = 0; i < 30; i++) {
      const pkgPath = join(dir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          if (JSON.parse(readFileSync(pkgPath, "utf8")).name === specifier) return pkgPath;
        } catch { /* 继续向上 */ }
      }
      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    return null;
  }
  return null;
}

/** 输出目录可写检查：尝试建目录并写入探针文件后删除。 */
function isOutputDirWritable(dir) {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.write-probe-${process.pid}`);
    writeFileSync(probe, "ok", "utf8");
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** 从 cwd 向上查找 @deepseek-ai/dsh 的 package.json（已安装包，不依赖仓库内硬编码路径）。 */
function findDshPackage(cwd = process.cwd()) {
  let dir = resolve(cwd);
  for (let i = 0; i < 8; i++) {
    const p = join(dir, "node_modules", "@deepseek-ai", "dsh", "package.json");
    if (existsSync(p)) return p;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function doctorCommand(cwd = process.cwd()) {
  let failures = 0;
  const check = (label, ok, advice) => {
    info(`[${ok ? "PASS" : "FAIL"}] ${label}`);
    if (!ok) {
      warn(advice ?? "");
      failures++;
    }
  };

  const major = Number(process.versions.node.split(".")[0]);
  check(`Node.js >= 20（当前 ${process.versions.node}）`, major >= 20, "请升级到 Node.js 20 或更高版本。");

  let coreOk = false;
  try {
    await import("@dsh-reliability/core");
    coreOk = true;
  } catch {
    coreOk = false;
  }
  check("@dsh-reliability/core 可解析", coreOk, "请先运行 npm install 完成 workspace 链接，再重试 doctor。");

  const pluginPkg = resolvePackageJson("@dsh-reliability/dsh-plugin");
  const pluginVersion = pluginPkg ? readPkgVersion(pluginPkg) : null;
  info(pluginVersion
    ? `[PASS] @dsh-reliability/dsh-plugin 版本 ${pluginVersion}`
    : "[WARN] 未找到 @dsh-reliability/dsh-plugin 包（不阻塞离线运行）");

  const dshPkg = findDshPackage(cwd);
  if (dshPkg) {
    const v = readPkgVersion(dshPkg);
    if (v === "0.1.0-rc.7") {
      info(`[PASS] @deepseek-ai/dsh 版本 ${v}（插件兼容）`);
    } else {
      warn(`@deepseek-ai/dsh 版本 ${v}，插件兼容版本为 0.1.0-rc.7，请核对。`);
    }
  } else {
    info("[WARN] 未找到 @deepseek-ai/dsh（插件仍可独立加载；仅真实 DSH 容器测试需要）");
  }

  const cp = configPath(cwd);
  let outDir = resolveOutputDir(DEFAULT_CONFIG.out, cwd);
  if (existsSync(cp)) {
    info(`[PASS] 找到配置文件 ${cp}`);
    try {
      const cfg = loadConfig(cwd);
      outDir = resolveOutputDir(cfg.out, cwd);
    } catch (err) {
      check("配置文件有效", false, String(err?.message ?? err));
    }
  } else {
    info("[WARN] 未找到 dsh-reliability.config.json（可运行 dsh-reliability init 生成）");
  }

  check(`输出目录可写（${outDir}）`, isOutputDirWritable(outDir), `输出目录 ${outDir} 不可写，请检查权限。`);

  if (process.env.DEEPSEEK_API_KEY) {
    info("[PASS] 已设置 DEEPSEEK_API_KEY（真实测试可用）");
  } else {
    info("[WARN] 未设置 DEEPSEEK_API_KEY（离线 mock 测试不受影响；真实测试前需设置）");
  }

  const fixturePath = resolveCasesPath(undefined, cwd);
  check("fixtures/basic.jsonl 存在", Boolean(fixturePath), "缺少离线夹具，请检查安装完整性。");

  return failures > 0 ? EXIT_FAILURE : EXIT_OK;
}
