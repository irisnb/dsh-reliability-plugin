# dsh-reliability-plugin

针对 DSH 回答的可靠性检查，变成可重复、可复查的自动测试。

DSH（npm 包 `@deepseek-ai/dsh`）是 DeepSeek 提供的智能体框架，基于 Cordis 插件体系。把它嵌入应用后，回答一旦踩过事实、引用、推测或版本冲突的边界，错误会悄悄出现、很难被发现。本项目提供一套离线优先的测试工具，让你用固定案例反复验证这些回答，并留下可人工复核的证据。

## 它是什么

一套离线优先的测试工具，由三部分组成：

| 包 | 作用 |
| --- | --- |
| `@dsh-reliability/core` | 可复用核心：案例加载、运行编排、保守自动初筛、证据落盘 |
| `@dsh-reliability/dsh-plugin` | DSH Cordis 测试插件：白盒事件探针、确定性 Mock LLM、显式故障注入 |
| `dsh-reliability-plugin` | 开箱即用 CLI，提供 `dsh-reliability` 命令 |

它只做测试与观测：不读写任何用户作品，不修改模型请求或回答，不注册让模型自主调用的工具。

## 快速开始

无需任何 API key，全程离线：

```bash
git clone https://github.com/irisnb/dsh-reliability-plugin.git
cd dsh-reliability-plugin

npm install
npx dsh-reliability doctor          # 环境自检
npx dsh-reliability run --mode mock # 离线验证（Mock LLM）
```

也可以直接用 npm 安装：

```bash
npm install dsh-reliability-plugin
npx dsh-reliability init
npx dsh-reliability doctor
```

## 真实模型测试

真实 DSH 测试需要驱动脚本路径和 API key，两者都只从环境变量读取、绝不落盘：

```powershell
# PowerShell
$env:DEEPSEEK_API_KEY = "your-key"
$env:DSH_DRIVER_PATH = "path\to\driver.mjs"
npx dsh-reliability run --mode real --model deepseek-v4-pro --driver path\to\driver.mjs
```

只有 DeepSeek API key、没有 DSH 容器时，用兼容 API 测试器（`--mode api`，OpenAI 兼容端点，非 DSH 测试）：

```powershell
npx dsh-reliability run --mode api --model deepseek-v4-pro
```

## 文档

| 文档 | 内容 |
| --- | --- |
| [安装与运行](docs/installation.md) | 环境要求、安装、离线与真实测试、配置 |
| [插件开发](docs/plugin-development.md) | Cordis 插件契约、事件归一化、开发约束 |
| [故障排查](docs/troubleshooting.md) | 常见报错与处理办法 |

## 仓库结构

```text
packages/
  core/        案例加载、运行编排、保守自动初筛与证据保存
  dsh-plugin/  DSH Cordis 插件：白盒探针、Mock LLM 与故障注入
  cli/         命令行入口（bin: dsh-reliability）
fixtures/      固定案例与离线材料
examples/      最小配置与案例格式说明
docs/          安装、插件开发与故障排查
test/          离线单元测试与插件集成测试
```

## 关键边界

- **AI 不改用户文档。** 本项目只产出证据与报告，绝不写入任何用户作品或文本。
- **API key 只从环境变量读取。** 密钥不进入案例、报告、证据、标准输出或错误日志，落盘前统一脱敏。
- **离线优先。** 默认 `run` 为 mock 模式，不联网、不需要 key。
- **保守评分。** 自动初筛只做"足够明确"的判定，输出 `PASS_LIKELY` / `FAIL_LIKELY` / `NEEDS_REVIEW` / `RUNTIME_ERROR`，不把关键词命中冒充绝对裁判。
- **插件默认只读。** Mock 与故障注入必须由测试配置显式开启。
