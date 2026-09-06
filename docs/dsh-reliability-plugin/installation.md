# 安装与运行

## 环境要求

| 组件 | 要求 |
| --- | --- |
| Node.js | >= 20 |
| npm | >= 9（npm workspaces） |
| DSH | `@deepseek-ai/dsh` `0.1.0-rc.7`（仅真实 DSH 容器测试需要，插件作为 optional peer 依赖，缺省不影响离线运行） |
| API key | 仅 `--mode real` / `--mode api` 需要，从环境变量 `DEEPSEEK_API_KEY` 读取 |

## 安装

### Git 部署

```bash
git clone https://github.com/OWNER/dsh-reliability-plugin.git
cd dsh-reliability-plugin
npm install
npx dsh-reliability doctor
npm test
```

### npm 部署

```bash
npm install dsh-reliability-plugin
npx dsh-reliability init
npx dsh-reliability doctor
```

## 离线验证（无需 key）

```bash
npx dsh-reliability run --mode mock
```

输出到 `artifacts/runs/<run-id>/`：

```text
manifest.json
report.json
report.html
cases/<case-id>.json
```

离线验证使用 Mock LLM，检查插件加载、案例校验、评分、证据输出与故障注入，不请求真实模型。

## 真实模型测试

真实 DSH 测试（`--mode real`）经 JSONL 驱动适配器运行，需要驱动脚本路径与 `DEEPSEEK_API_KEY`：

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
$env:DSH_DRIVER_PATH = "path\to\driver.mjs"
npx dsh-reliability run --mode real --model deepseek-v4-pro --driver path\to\driver.mjs
```

只有 DeepSeek API key 而没有 DSH 容器时，可用兼容 API 测试器（`--mode api`，OpenAI 兼容 REST 端点，非 DSH 测试）：

```powershell
npx dsh-reliability run --mode api --model deepseek-v4-pro
```

真实测试只从环境变量读取 key，绝不进入案例、报告、证据或日志。真实测试不进公开 CI。

## 配置

`dsh-reliability init` 生成 `dsh-reliability.config.json`：

```json
{
  "model": "deepseek-v4-pro",
  "mode": "mock",
  "cases": "fixtures/basic.jsonl",
  "out": "artifacts/runs",
  "apiBase": "https://api.deepseek.com"
}
```

命令行参数优先于配置文件。`cases` 可为单个 `.json` / `.jsonl` 文件或目录。
