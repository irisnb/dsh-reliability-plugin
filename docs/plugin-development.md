# 插件开发

`@dsh-reliability/dsh-plugin` 是标准 DSH Cordis 测试插件。

## 加载方式

插件通过标准 Cordis `apply(ctx, options)` 函数导出，并在 `package.json` 用 optional peerDependency 精确声明兼容版本：

```json
{
  "peerDependencies": { "@deepseek-ai/dsh": "0.1.0-rc.7" },
  "peerDependenciesMeta": { "@deepseek-ai/dsh": { "optional": true } }
}
```

在 DSH 测试容器中，把插件名加入 profile 的条目列表即可加载（与 `cordis.driver.yaml` 中其它条目一致）。插件不 import `@deepseek-ai/dsh` 或 cordis，因此也能脱离 DSH 独立运行（standalone 模式），加载失败会优雅降级。

## 契约

```js
export const name = "reliability-probe";
export const inject = [];          // 无必需服务，只读观测
export function apply(ctx, options) { ... }
export default apply;
```

`apply` 返回：

| 成员 | 说明 |
| --- | --- |
| `sink` | 进程内 `ProbeSink`（`onEvent` / `events` / `flush`） |
| `mock` | 确定性 Mock LLM（`enabled` 默认 false，启用后 `respond({text, material})`） |
| `fault` | 故障注入（`enabled` 默认 false，启用后 `timeout` / `cancel` / `protocolError` / `simulatedAbnormalExit`，其中异常退出为「模拟」能力，结构化返回 error 结果，不真实终止进程） |
| `observe(raw, ctx)` | 把原始 DSH 生命周期事件归一化为 `DshTraceEvent` 并转发给 sink |

## 约束

- 不注册供模型自主调用的可靠性测试 Tool；
- 不修改请求参数或模型回答；
- 不写入用户文件或作品数据；
- 不自行判定评分结果；
- 不覆盖 DSH 生产工具安全配置。

## 事件归一化

`normalizeEvent` 把已知 DSH 事件类型映射为稳定的 `DshTraceEvent`：

| 原始事件 | kind |
| --- | --- |
| `session_started` | `session_started` |
| `user/message` | `request_started` |
| `assistant/chunk` | `response_delta` |
| `assistant/message` / `message_done` | `response_complete` |
| `compaction/*` | `compaction` |
| `message_failed` / `error` | `request_failed` |

事件携带稳定的会话/轮次/消息标识，且绝不包含 API key。脱敏由 core 的 `createEvidenceStore` 在落盘前统一处理。
