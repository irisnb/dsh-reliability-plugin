# DSH Reliability Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有回答可靠性测试器封装为当前仓库内可独立发布的 `dsh-reliability-plugin` 原型，包含可复用 core、DSH Cordis 插件、开箱即用 CLI、离线验证和发布文档。

**Architecture:** 在 `packages/` 下建立三个独立包。core 复用并适配现有案例校验、筛查和证据逻辑；dsh-plugin 提供标准 Cordis 插件、探针、Mock 和故障注入；CLI 负责 doctor、离线运行、真实运行和报告输出。当前仓库先作为发布源实现，不能修改 Next Story 生产驱动或作品链路。

**Tech Stack:** Node.js ESM、现有 `@deepseek-ai/dsh 0.1.0-rc.7`、Node built-in test runner、npm workspaces、JSON/JSONL fixtures、GitHub Actions。

---

### Task 1: 建立发布包骨架

**Files:**
- Create: `packages/core/package.json`, `packages/core/src/index.mjs`
- Create: `packages/dsh-plugin/package.json`, `packages/dsh-plugin/src/index.mjs`
- Create: `packages/cli/package.json`, `packages/cli/bin/dsh-reliability.mjs`
- Create: `package.json`, `.gitignore`
- Test: `test/package-layout.test.mjs`

- [ ] **Step 1: Write the failing package-layout test**

验证三个包存在、CLI bin 可解析、插件包声明精确的 DSH 版本。

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test test/package-layout.test.mjs`
Expected: FAIL because the package files do not exist.

- [ ] **Step 3: Add the workspace manifests and minimal exports**

根 `package.json` 使用 npm workspaces；core、plugin、cli 使用 ESM；plugin 将 `@deepseek-ai/dsh` 锁定为 `0.1.0-rc.7`；CLI 提供可执行 bin。

- [ ] **Step 4: Run the layout test**

Run: `node --test test/package-layout.test.mjs`
Expected: PASS.

### Task 2: 提取 core 运行接口

**Files:**
- Modify: `sidecar/reliability/schema.mjs`
- Modify: `sidecar/reliability/screening.mjs`
- Modify: `sidecar/reliability/evidence.mjs`
- Modify: `sidecar/reliability/driver-client.mjs`
- Create: `packages/core/src/cases.mjs`, `packages/core/src/screening.mjs`, `packages/core/src/evidence.mjs`, `packages/core/src/runner.mjs`
- Test: `test/core-api.test.mjs`

- [ ] **Step 1: Write failing API tests**

覆盖 `loadCases`、`screenAnswer`、`createEvidenceStore` 和 `runReliability` 的导出、四种结果状态、运行错误与密钥脱敏。

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/core-api.test.mjs`
Expected: FAIL because the new core exports do not exist.

- [ ] **Step 3: Implement thin adapters over the existing tested behavior**

复制或重导出已有确定性逻辑，不能改变现有评分规则；core 的 runner 接收 `DshAdapter` 和 `ProbeSink`，并将结果写入独立 output directory。

- [ ] **Step 4: Run focused tests and existing reliability tests**

Run: `node --test test/core-api.test.mjs sidecar/reliability/tests/*.test.mjs`
Expected: all tests pass.

### Task 3: 实现 DSH Cordis 测试插件

**Files:**
- Create: `packages/dsh-plugin/src/probe.mjs`
- Create: `packages/dsh-plugin/src/mock-llm.mjs`
- Create: `packages/dsh-plugin/src/fault-injection.mjs`
- Modify: `packages/dsh-plugin/src/index.mjs`
- Create: `test/dsh-plugin.test.mjs`
- Reference: `sidecar/driver/driver.mjs`, `sidecar/driver/cordis.driver.yaml`, `sidecar/probe/probe.mjs`

- [ ] **Step 1: Write failing plugin contract tests**

验证插件导出可加载的 Cordis apply 函数，默认只读，能够向 `ProbeSink` 转发标准事件；Mock 和故障注入未显式开启时不生效。

- [ ] **Step 2: Run focused plugin tests and confirm failure**

Run: `node --test test/dsh-plugin.test.mjs`
Expected: FAIL because the plugin implementation is incomplete.

- [ ] **Step 3: Implement the read-only probe and explicit test capabilities**

使用当前 DSH 已验证的生命周期接口；不得注册可靠性测试 Tool，不得修改请求或回答，不得写入作品文件。Mock 和故障注入使用测试配置开关并返回结构化事件。

- [ ] **Step 4: Run plugin tests**

Run: `node --test test/dsh-plugin.test.mjs`
Expected: PASS.

### Task 4: 实现 CLI 与用户流程

**Files:**
- Modify: `packages/cli/bin/dsh-reliability.mjs`
- Create: `packages/cli/src/commands/doctor.mjs`, `packages/cli/src/commands/init.mjs`, `packages/cli/src/commands/run.mjs`
- Create: `packages/cli/src/config.mjs`, `packages/cli/src/output.mjs`
- Test: `test/cli.test.mjs`

- [ ] **Step 1: Write failing CLI tests**

验证 `doctor`、`init`、`run --mode mock`、缺少 key 的中文错误提示和退出码。

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --test test/cli.test.mjs`
Expected: FAIL because commands are not implemented.

- [ ] **Step 3: Implement the commands**

CLI 支持 Git checkout 和 npm 安装后的调用；默认运行离线模式不需要 API key；真实模式只读取 `DEEPSEEK_API_KEY`；输出 `manifest.json`、`report.json`、`report.html` 和案例证据。

- [ ] **Step 4: Run CLI tests and help command**

Run: `node --test test/cli.test.mjs`; `node packages/cli/bin/dsh-reliability.mjs --help`
Expected: tests pass and help lists `init`, `doctor`, `run`.

### Task 5: 添加 fixtures、示例、文档和 CI

**Files:**
- Create: `fixtures/basic.jsonl`, `examples/minimal-config.json`, `examples/README.md`
- Create: `README.md`, `LICENSE`, `CHANGELOG.md`, `docs/installation.md`, `docs/plugin-development.md`, `docs/troubleshooting.md`
- Create: `.github/workflows/test.yml`
- Test: `test/clean-install.test.mjs`

- [ ] **Step 1: Write the clean-install and documentation smoke tests**

验证 README 中的命令、fixture 路径、示例配置和 package scripts 一致。

- [ ] **Step 2: Implement the first-user path**

README 第一屏提供 clone、install、doctor、offline test 和 real test；文档说明 DSH 插件加载方式、支持版本、密钥保护和明确不读取作品。

- [ ] **Step 3: Add cross-platform offline CI**

GitHub Actions 在 Windows、macOS、Linux 上执行 install、offline tests 和 package layout tests；真实 API 不进入 CI。

- [ ] **Step 4: Run the complete offline verification**

Run: `npm test`
Expected: all local package, plugin, CLI and existing reliability tests pass without an API key.

### Task 6: 集成验收与发布检查

**Files:**
- Modify: affected package manifests and docs only when verification finds a concrete issue.
- Test: all repository tests and package smoke tests.

- [ ] **Step 1: Run complete verification**

Run: `npm test`; `npm run test:reliability`; `node packages/cli/bin/dsh-reliability.mjs doctor --mode offline`.
Expected: all pass; no API key is required for offline commands.

- [ ] **Step 2: Inspect package contents and secret safety**

Run: `npm pack --dry-run --workspaces`; search generated artifacts and docs for real secrets. Expected: only intended package files are included and no key is present.

- [ ] **Step 3: Inspect Git diff and preserve unrelated user changes**

Run: `git status --short`; `git diff --stat`; verify `方向/行动计划-2026-08-27.md` remains untouched by this work.

- [ ] **Step 4: Prepare release notes without publishing or pushing**

Record the supported DSH version, offline verification command, real-test prerequisites, and remaining limitation that the public GitHub owner URL and npm publication identity are assigned at release time.
