# Changelog

本文件记录 `dsh-reliability-plugin` 的版本变更。版本遵循语义化版本。

## 0.1.0（首个可运行原型）

- 新增 `@dsh-reliability/core`：`loadCases` / `screenAnswer` / `createEvidenceStore` / `runReliability` 稳定接口，以及 `MockAdapter`、`RestApiAdapter`、`DriverAdapter`（真实 JSONL DSH 驱动，自包含，不依赖 Next Story sidecar 路径）。
- 新增 `@dsh-reliability/dsh-plugin`：标准 Cordis 插件（`apply` / `name` / `inject`），白盒探针（含基础密钥脱敏）、确定性 Mock LLM 与显式故障注入（含 `simulatedAbnormalExit` 模拟异常退出），默认只读观测。
- 新增 `dsh-reliability-plugin` CLI：`init` / `doctor` / `run`，`run` 默认离线 mock；`--mode real` 经 JSONL DSH 驱动（需 `--driver`/`DSH_DRIVER_PATH`）；`--mode api` 为 OpenAI 兼容 API 测试器（非 DSH 测试）。密钥只从 `DEEPSEEK_API_KEY` 读。
- 评分规则复用并镜像已验收的 `sidecar/reliability` 逻辑，附一致性守门测试，保证无规则分叉。
- 输出 `manifest.json` / `report.json` / `report.html` / `cases/*.json`，落盘前统一脱敏并复核；runId/caseId 限制为安全文件名，拒绝路径穿越与重复 case id。
- 支持 DSH 版本：`@deepseek-ai/dsh` `0.1.0-rc.7`（optional peer 依赖，精确锁定）。
- 新增离线单元测试、插件集成测试、CLI 测试与干净安装烟雾测试，全部无需网络与 API key。
- 已知限制：公开 GitHub 仓库归属（OWNER）与 npm 发布身份在正式发布时分配；真实 DSH 驱动脚本与容器不在发布包内，需外部提供。
