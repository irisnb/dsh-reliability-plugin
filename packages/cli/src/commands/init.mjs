// init.mjs — 初始化本地配置（dsh-reliability-plugin）
import { existsSync, writeFileSync } from "node:fs";
import { DEFAULT_CONFIG, configPath } from "../config.mjs";
import { EXIT_OK, info } from "../output.mjs";

export function initCommand(cwd = process.cwd()) {
  const p = configPath(cwd);
  if (existsSync(p)) {
    info(`配置文件已存在：${p}（未覆盖）`);
    return EXIT_OK;
  }
  writeFileSync(p, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf8");
  info(`已生成配置文件：${p}`);
  info("下一步：dsh-reliability doctor 检查环境，然后 dsh-reliability run 离线验证。");
  return EXIT_OK;
}
