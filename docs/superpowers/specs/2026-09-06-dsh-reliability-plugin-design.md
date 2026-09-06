# DSH 可靠性测试插件设计

## 1. 目标

将现有回答可靠性测试器封装为一个可独立发布的公开项目：

- 项目名：`dsh-reliability-plugin`
- 发布形式：标准 DSH Cordis 插件 + 开箱即用 CLI
- 安装方式：npm 安装和 `git clone` 均可用
- 使用对象：需要验证 DSH 回答可靠性的开发者和维护者
- 主要结果：可重复运行的测试、结构化证据、自动初筛和人工复核入口

用户从 GitHub 找到仓库后，不需要先理解内部架构即可完成安装、离线验证和真实模型测试。插件可加载到 DSH 测试环境中，CLI 作为独立的编排和验证入口保留。

## 2. 范围边界

### 本次包含

- 将案例加载、校验、运行编排、自动初筛和证据保存整理为可复用 core。
- 提供 DSH Cordis 测试插件。
- 提供白盒事件探针，记录 DSH 请求、响应和相关运行事件。
- 提供测试专用 Mock LLM 和显式故障注入能力。
- 提供用户无需编写宿主代码即可运行的 CLI。
- 提供 npm、Git、离线测试、真实测试和故障排查文档。
- 提供示例配置、版本兼容说明、许可证、变更记录和 GitHub Actions。

### 本次不包含

- 不实现“让 AI 看见作品”。
- 不读取、索引、摘要、检索或保存 Next Story 用户作品。
- 不接入 Next Story 前端、Rust 后端或生产 DSH 驱动。
- 不把测试器注册为让模型自主调用的 DSH Tool。
- 不提供在线监控平台或用户可见 UI。
- 不把开放性创作判断压缩为单一正确答案。

## 3. 仓库结构

```text
dsh-reliability-plugin/
├── packages/
│   ├── core/                 案例、运行、评分和证据的稳定接口
│   ├── dsh-plugin/           DSH Cordis 插件、探针、Mock 和故障注入
│   └── cli/                  开箱即用命令行入口
├── fixtures/                 固定案例和长上下文材料
├── examples/                 最小可运行配置和示例
├── docs/                     安装、配置、扩展和故障排查
├── test/                     离线单元测试和插件集成测试
├── package.json
├── README.md
├── LICENSE
├── CHANGELOG.md
└── .github/workflows/        干净环境中的自动验证
```

职责必须保持分离：

- `core` 负责测试编排、案例校验、自动初筛、证据和报告结构。
- `dsh-plugin` 负责在 DSH 内观察测试运行，并提供测试专用替身能力。
- `cli` 负责参数解析、环境检查、启动测试环境和输出用户可读摘要。
- 插件不决定测试结果，评分器不进入 Agent 思考链。

## 4. 运行架构

```text
CLI
  ↓ 编排测试
Core
  ├── CaseSource          加载并校验案例
  ├── DshAdapter          对接 DSH 驱动或 Cordis 容器
  ├── Screener            保守自动初筛
  └── EvidenceStore       脱敏证据和报告
          ↑
DSH Cordis Plugin
  ├── Reliability Probe   白盒事件观测
  ├── Mock LLM            确定性离线响应
  └── Fault Injection     显式测试故障
```

默认运行使用 JSONL Driver Adapter，以兼容已经验证的 DSH 驱动协议；Direct Cordis Adapter 仅用于测试专用模式，用于白盒探针、Mock LLM 和故障注入。

插件的默认行为是只读观测。Mock 和故障注入必须由测试配置显式开启，不能因为插件被加载就影响普通 DSH 会话。

## 5. 稳定接口

Core 对外提供版本化接口，内部实现可以替换而不要求使用者修改案例：

```ts
type TestRunOptions = {
  cases: TestCase[]
  model: string
  apiBase: string
  runId?: string
  mode: "real" | "mock"
  outputDir: string
}

type TestRunResult = {
  runId: string
  counts: {
    passLikely: number
    failLikely: number
    needsReview: number
    runtimeError: number
  }
  evidenceDir: string
}

interface DshAdapter {
  start(options: DshStartOptions): Promise<void>
  startSession(seed?: SeedTurn[]): Promise<SessionHandle>
  sendMessage(session: SessionHandle, text: string): Promise<AssistantResponse>
  cancelMessage(session: SessionHandle): Promise<void>
  endSession(session: SessionHandle): Promise<void>
}

interface ProbeSink {
  onEvent(event: DshTraceEvent): void
  flush(): Promise<void>
}
```

插件向 core 提供标准化的 `DshTraceEvent`，至少覆盖会话开始、请求开始、响应增量、响应完成、压缩事件和请求失败。事件必须包含稳定的会话/轮次标识，并且不得包含 API key 或其他未经脱敏的凭据。

未来若需要测试作品上下文，只允许新增独立的测试输入适配器，例如 `ContextFixtureProvider`。这只是接口预留，本次不访问作品数据。

## 6. 插件设计

插件以标准 Cordis 插件形式发布，并固定兼容当前支持的 `@deepseek-ai/dsh 0.1.0-rc.7`。依赖版本必须精确锁定，避免预览版 API 变化导致用户安装后静默失效。

插件负责：

- 订阅 DSH Agent 和 LLM 生命周期事件；
- 记录实际测试请求与完整响应的结构化摘要；
- 为测试运行提供 Mock LLM；
- 在测试配置中按需注入超时、取消、协议错误和异常退出等故障；
- 将观测事件交给 `ProbeSink`，由 core 统一保存证据。

插件不负责：

- 修改请求参数或模型回答；
- 注册供模型自主调用的可靠性测试 Tool；
- 写入用户文件或作品数据；
- 自己判定 `PASS_LIKELY`、`FAIL_LIKELY` 或人工复核结果；
- 覆盖 DSH 的生产工具安全配置。

## 7. 用户使用流程

README 第一屏直接提供最短路径。用户可以选择 npm 或 Git 部署。

### Git 部署

```bash
git clone https://github.com/OWNER/dsh-reliability-plugin.git
cd dsh-reliability-plugin
npm install
npm run doctor
npm test
```

### npm 部署

```bash
npm install dsh-reliability-plugin
npx dsh-reliability init
npx dsh-reliability doctor
```

### 离线验证

```bash
npm run test:offline
```

离线验证不需要 API key，不请求真实模型，使用 Mock LLM 检查插件加载、案例校验、评分、证据输出和故障注入。

### 真实模型测试

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
npx dsh-reliability run --model deepseek-v4-pro
```

API key 只从环境变量读取，不能进入案例、报告、证据、标准输出或错误日志。真实测试不进入公开 CI，避免泄露密钥和产生不可控费用。

### 环境检查

`doctor` 命令检查 Node.js、依赖、插件版本、DSH 版本、配置文件、API key 状态和证据输出目录。发现问题时输出可执行的中文处理建议；离线模式不因缺少 API key 失败。

## 8. 输出和证据

每次运行生成独立目录：

```text
artifacts/runs/<run-id>/
├── manifest.json
├── report.json
├── report.html
└── cases/<case-id>.json
```

证据至少包含案例和材料身份、模型与非敏感配置、时间、协议终态、完整回答、相关事件摘要、自动结果、理由、运行错误和脱敏检查结果。人工复核结果独立于自动结果，不能覆盖原始自动判定。

CLI 输出四种自动状态：`PASS_LIKELY`、`FAIL_LIKELY`、`NEEDS_REVIEW`、`RUNTIME_ERROR`。评分继续遵循现有回答可靠性测试规格的保守规则，不能把关键词命中冒充绝对裁判。

## 9. 测试和发布验收

### 自动测试

- Core 单元测试覆盖案例校验、筛查边界、证据序列化和密钥脱敏。
- 插件集成测试覆盖正常观测、Mock LLM、故障注入和事件转发。
- CLI 测试覆盖 `doctor`、离线运行、退出码和输出目录。
- 干净环境测试覆盖 npm 安装和 Git 克隆后的首次运行。
- 不在 CI 中调用真实模型 API。

### 发布要求

- README 提供从安装到首次成功运行的完整步骤。
- 提供最小示例配置和常见错误处理。
- 提供 `LICENSE`、`CHANGELOG.md`、支持的 Node/DSH 版本表和安全说明。
- GitHub Actions 至少验证 Windows、macOS、Linux 的离线流程。
- GitHub 仓库公开，仓库名为 `dsh-reliability-plugin`，并使用 `dsh`、`deepseek`、`cordis`、`reliability-testing`、`llm-testing` 等主题，方便用户搜索。
- 首个 Release 必须包含可安装版本、变更说明和与 DSH 版本的对应关系。

完成标准是：用户从公开 GitHub 仓库获取项目后，在没有 API key 的情况下可以完成离线验证；配置真实模型后可以运行案例并得到可复查报告；在 DSH 测试环境中加载插件后，白盒探针、Mock 和故障注入测试全部通过；整个过程不依赖 Next Story，也不触碰用户作品。

## 10. 后续变更边界

未来的作品上下文接入、在线产品集成、生产环境观测或 Agent 自动上下文能力，必须另开独立 OpenSpec change，遵循 `propose → 用户确认 → apply → archive`。本设计不授权这些功能提前实现。
