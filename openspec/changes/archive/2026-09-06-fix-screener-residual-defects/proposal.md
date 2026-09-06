## Why

长上下文幻觉压力测试四档 66 题跑完后，模型 66 题全部事实正确，但评分器在 20 题上误标（3 个假 `FAIL_LIKELY`、17 个过度保守的 `NEEDS_REVIEW`），根因是评分器与裁判键残留的 7 类缺陷。前两轮修复（`fix-negated-quotation-screening`、`fix-screener-false-failures`）已解决裸实体名与否定引用的误判，但下面 7 类仍在，导致测试器每次运行都产出大量误标、需要人工逐题核对，等于不可信。若测试器要保留为可复用资产，必须先把评分器修到可信。

## What Changes

- **修评分逻辑 `screening.mjs`（5 类）**：
  - 引文处理：模型主动引用原文作答时，识别为模型自己的结论，而非一律按「引用」退避到 `NEEDS_REVIEW`。
  - 不确定检测：扩充同义表达（无法得知 / 没有提供 / 没有出现 / 材料未提及 / 文中没有 等），不再只认「未知 / 未提及」两个词。
  - 隐含否定：识别「不是…最终选了 X」「选的是 X 而非 Y」这类靠语境的否定，不再只认字面否定词。
  - 推断措辞：区分「回答里含推断措辞」与「回答结论本身不确定」，不再把「可推断」「没有提到」误读为「回答不确定」。
  - 否定短语匹配：让 `mustNegate` 与模型的「不在 / 不是 / 没有」等否定表达正确对位。
- **修裁判键（2 类）**：
  - 裸称谓 / 职业词（侄子 / 儿子 / 医生 / 教师等）写完整命题短语（如「沈砚是林秀兰的侄子」），缺主语谓词补主语（如「苏晚住在盐城」）。
  - 出题过严：材料未唯一确定的结论（如「外甥」）不再写成唯一 `mustContain`，允许「外甥 / 侄子一类、材料未明确」这类诚实的回答。
- **加离线重评脚本**：对已保存的 66 份证据用新评分器重评，验证修复效果，不花 API 钱。
- **更新 / 新增单元测试**：覆盖全部 7 类缺陷。

## Capabilities

### New Capabilities

（无。本次是既有能力的缺陷修复，不引入全新能力。）

### Modified Capabilities

- `answer-reliability-testing`：更新「Conservative automatic screening」与「Proposition-level boundary phrases」需求，覆盖引文识别、不确定同义、隐含否定、推断措辞区分、否定短语匹配、裸称谓/职业词、缺主语谓词。
- `long-context-hallucination-fixtures`：更新「Separate factual oracle」需求，明确裁判键不得把材料未唯一确定的结论写成唯一正确答案。

## Impact

- `sidecar/reliability/screening.mjs`：评分逻辑（核心改动，不动生产 driver）。
- `sidecar/reliability/long-context/story-specs.mjs`：裁判键生成（裸词、过严结论修正）。
- `sidecar/reliability/long-context/oracle/*.json`：确定性重新生成。
- `sidecar/reliability/tests/screening.test.mjs` 及新增测试。
- 新增 `sidecar/reliability/rescore.mjs`（离线重评已保存证据）。
- 不碰 `sidecar/driver/driver.mjs`、前端、Rust 后端、用户作品。
