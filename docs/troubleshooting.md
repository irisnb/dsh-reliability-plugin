# 故障排查

## `dsh-reliability: command not found`

npm 全局/本地 bin 未生效。用 `npx dsh-reliability` 调用，或在 `npm install` 后检查 `node_modules/.bin`。

## `[错误] 真实测试需要 DEEPSEEK_API_KEY 环境变量`

`--mode real` / `--mode api` 只从环境变量读 key，且绝不写进配置或日志。离线验证请用 `--mode mock`；真实测试前先设置：

- PowerShell：`$env:DEEPSEEK_API_KEY = "your-key"`
- Unix：`export DEEPSEEK_API_KEY=your-key`

## `[错误] 真实 DSH 测试需要驱动脚本路径`

`--mode real` 经 JSONL 驱动适配器运行，需要显式提供驱动脚本路径（`--driver <路径>` 或 `DSH_DRIVER_PATH` 环境变量）。驱动脚本不在发布包内。若只有 DeepSeek API key 而没有 DSH 容器，请改用 `--mode api`（OpenAI 兼容 API 测试器，非 DSH 测试）。

## `找不到案例路径`

`--cases` 或默认 `fixtures/basic.jsonl` 不存在。检查是否在仓库根目录运行，或用 `--cases` 指定绝对路径。`doctor` 会报告夹具是否缺失。

## `@dsh-reliability/core 可解析` 检查失败

workspace 尚未链接。运行 `npm install` 完成 workspace 链接后重试 `npx dsh-reliability doctor`。

## 未找到 `@deepseek-ai/dsh`

这是警告，不是错误：插件仍可独立加载与离线运行。只有真实 DSH 容器测试需要它，且版本须为 `0.1.0-rc.7`（`doctor` 会核对）。

## 证据里看到 `[REDACTED]`

这是预期的脱敏行为。core 在落盘前统一替换密钥（含通用 `sk-` 模式），并在每条记录写入 `secret_check` 字段说明泄漏复核结果。

## 运行结果全是 `NEEDS_REVIEW` 或 `RUNTIME_ERROR`

- `NEEDS_REVIEW`：保守初筛对否定、引用、不确定、事实与推测边界一律人工复核，这是刻意的保守行为，不代表测试失败。
- `RUNTIME_ERROR`：查看 `cases/<id>.json` 的 `runtime_error.category` / `message` 定位（驱动启动失败、超时、协议错误、密钥泄漏等）。

## 离线测试仍失败

依次运行 `npx dsh-reliability doctor`（检查环境）与 `npm test`（跑离线单元测试）。确保 Node >= 20 且 `npm install` 已成功完成。
