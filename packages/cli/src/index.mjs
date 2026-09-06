// index.mjs — dsh-reliability-plugin CLI 入口
import { runCommand, parseRunArgs } from "./commands/run.mjs";
import { doctorCommand } from "./commands/doctor.mjs";
import { initCommand } from "./commands/init.mjs";
import { EXIT_OK, EXIT_FAILURE, EXIT_USAGE } from "./output.mjs";

export { runCommand, parseRunArgs };
export { doctorCommand };
export { initCommand };
export { EXIT_OK, EXIT_FAILURE, EXIT_USAGE };
export { DEFAULT_CONFIG, loadConfig } from "./config.mjs";

export const CLI_VERSION = "0.1.0";

export const HELP = `dsh-reliability ${CLI_VERSION} — DSH 回答可靠性测试器

用法：
  dsh-reliability <命令> [选项]

命令：
  init      生成本地配置 dsh-reliability.config.json
  doctor    检查 Node.js、依赖、DSH 兼容版本、配置与 API key 状态
  run       运行测试（默认离线 mock，无需 API key）

run 选项：
  --mode <mock|real|api>  运行模式（默认 mock，离线；real=真实 DSH 驱动，api=兼容 API 测试器）
  --model <名称>       模型标识（默认取配置，real/api 模式必填）
  --cases <路径>       案例文件或目录（默认 fixtures/basic.jsonl）
  --out <目录>         证据输出目录（默认 artifacts/runs）
  --api-base <url>     real/api 模式的 API 端点（默认取配置）
  --driver <路径>      real 模式的 DSH 驱动脚本路径（或设 DSH_DRIVER_PATH）
  --run-id <id>        指定运行标识（默认按时间戳生成）

示例：
  dsh-reliability init
  dsh-reliability doctor
  dsh-reliability run                     # 离线 mock，无需 key
  dsh-reliability run --mode real --model deepseek-v4-pro --driver /path/to/driver.mjs   # 需 DEEPSEEK_API_KEY
  dsh-reliability run --mode api --model deepseek-v4-pro   # 兼容 API 测试器（非 DSH），需 DEEPSEEK_API_KEY

全局：
  --help, -h    显示本帮助
  --version, -v 显示版本
`;

export async function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];

  if (cmd === undefined || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    return EXIT_OK;
  }
  if (cmd === "--version" || cmd === "-v") {
    console.log(`dsh-reliability ${CLI_VERSION}`);
    return EXIT_OK;
  }

  switch (cmd) {
    case "init":
      return initCommand(process.cwd());
    case "doctor":
      return await doctorCommand(process.cwd());
    case "run":
      return await runCommand(argv.slice(1), process.cwd());
    default:
      console.error(`[错误] 未知命令：${cmd}`);
      console.log(HELP);
      return EXIT_USAGE;
  }
}
