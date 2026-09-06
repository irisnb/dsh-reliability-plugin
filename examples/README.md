# 示例

## minimal-config.json

`dsh-reliability init` 会生成一份等价配置（`dsh-reliability.config.json`），字段含义：

| 字段 | 含义 | 默认值 |
| --- | --- | --- |
| `model` | real/api 模式使用的模型标识 | `deepseek-v4-pro` |
| `mode` | 默认运行模式（`mock` 离线 / `real` 真实 DSH 驱动 / `api` 兼容 API 测试器） | `mock` |
| `cases` | 案例文件或目录（相对 cwd） | `fixtures/basic.jsonl` |
| `out` | 证据输出目录 | `artifacts/runs` |
| `apiBase` | real/api 模式的 HTTP 端点 | `https://api.deepseek.com` |
| `driver` | real 模式的 DSH 驱动脚本路径（可选，或用 `DSH_DRIVER_PATH`） | `null` |

配置里**绝不写 API key**。真实测试的密钥只从环境变量 `DEEPSEEK_API_KEY` 读取。

## 案例格式

一个最小案例：

```json
{
  "id": "basic-fact",
  "material": {
    "name": "黄昏镇",
    "version": "1",
    "hash": "sha256:<64位十六进制>",
    "text": "黄昏镇在河谷西岸。老陈在镇口开了一间茶馆。"
  },
  "question": "老陈在镇上做什么？",
  "expect": {
    "factBoundary": { "mustContain": ["开了一间茶馆"], "mustNegate": [] },
    "wrongConclusions": [],
    "allowedUncertainty": [],
    "evidenceLocations": ["第二句"],
    "riskTags": ["fact-boundary"]
  }
}
```

`material.hash` 必须是 `material.text` 的 SHA-256（前缀 `sha256:`）。`allowedUncertainty` 非空表示该案例接受“未知/未提及”为正确回答。更多案例见 `fixtures/basic.jsonl` 与 `sidecar/reliability/fixtures/`。
