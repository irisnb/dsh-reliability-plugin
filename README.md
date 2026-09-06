# dsh-reliability-plugin

把 DSH 回答可靠性测试封装为**可独立发布**的项目：标准 DSH Cordis 测试插件 + 开箱即用 CLI。

它帮助你验证 DSH 回答的可靠性——可重复运行的案例测试、结构化证据、保守自动初筛和人工复核入口。全程**离线可用**：不需要 API key 即可完成安装、环境自检与离线验证；配置真实模型后即可运行案例并得到可复查报告。

> 本项目只做测试与观测，不读写任何用户作品，不修改模型请求/回答，不注册让模型自主调用的工具。

## 快速开始（第一屏）

```bash
# 1. 获取代码
git clone https://github.com/irisnb/dsh-reliability-plugin.git
cd dsh-reliability-plugin

# 2. 安装（无需任何 API key）
npm install

# 3. 环境自检
npx dsh-reliability doctor

# 4. 离线验证（Mock LLM，不联网、不需要 key）
npx dsh-reliability run --mode mock

# 5. 真实 DSH 测试（经 JSONL 驱动，只从环境变量读 key）
# 需要 DSH 驱动脚本路径 + DEEPSEEK_API_KEY
# PowerShell:
$env:DEEPSEEK_API_KEY = "your-key"
$env:DSH_DRIVER_PATH = "path\to\driver.mjs"
npx dsh-reliability run --mode real --model deepseek-v4-pro --driver path\to\driver.mjs
# Unix:
export DEEPSEEK_API_KEY=your-key
npx dsh-reliability run --mode real --model deepseek-v4-pro --driver /path/to/driver.mjs

# 6. 只有 API key 没有 DSH 容器？用兼容 API 测试器（OpenAI 兼容端点，非 DSH 测试）
npx dsh-reliability run --mode api --model deepseek-v4-pro
```

npm 安装方式：

```bash
npm install dsh-reliability-plugin
npx dsh-reliability init
npx dsh-reliability doctor
```

## 仓库结构

```text
packages/
  core/        案例加载、运行编排、保守自动初筛与证据保存的稳定接口
  dsh-plugin/  DSH Cordis 插件：白盒探针、Mock LLM 与故障注入
  cli/         开箱即用命令行入口（bin: dsh-reliability）
fixtures/      固定案例与离线材料
examples/      最小配置与案例格式说明
docs/          安装、插件开发与故障排查
test/          离线单元测试与插件集成测试
```

## 关键边界

- **AI 不改用户文档。** 本项目只产出证据与报告，绝不写入任何用户作品或文本。
- **API key 只从环境变量读取。** 密钥不进入案例、报告、证据、标准输出或错误日志，落盘前统一脱敏。
- **离线优先。** 默认 `run` 为 mock 模式，不联网、不需要 key；真实 DSH 测试显式 `--mode real`（需驱动脚本路径），兼容 API 测试用 `--mode api`（非 DSH 测试）。
- **保守评分。** 自动初筛只做“足够明确”的判定，输出 `PASS_LIKELY` / `FAIL_LIKELY` / `NEEDS_REVIEW` / `RUNTIME_ERROR`，不把关键词命中冒充绝对裁判。
- **插件默认只读。** Mock 与故障注入必须由测试配置显式开启，加载插件不影响普通 DSH 会话。

更多细节见 `docs/` 目录。
