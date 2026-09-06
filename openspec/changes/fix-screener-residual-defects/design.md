## Context

`screening.mjs` 是回答可靠性测试器的保守自动初筛：只做"足够明确"的判定，遇到否定、引用、不确定、推断歧义一律落到 `NEEDS_REVIEW`。前两轮修复（`fix-negated-quotation-screening`、`fix-screener-false-failures`）已解决裸实体名与否定引用误判。但四档 66 题压力测试暴露出 7 类残留缺陷，导致 20 题被误标（3 个假 `FAIL_LIKELY`、17 个过度保守的 `NEEDS_REVIEW`）。本 change 修复这些缺陷，同时不破坏"宁可 NEEDS_REVIEW 也不冤枉模型"的保守立场。

## Goals / Non-Goals

**Goals:**
- 消除 3 个假 `FAIL_LIKELY` 的根因（裸称谓词、缺主语谓词）。
- 大幅降低 17 个过度保守 `NEEDS_REVIEW`（引文、不确定同义、隐含否定、推断措辞、否定匹配、出题过严）。
- 提供离线重评能力，用已保存的 66 份证据验证修复，不花 API 钱。

**Non-Goals:**
- 不引入 LLM-as-judge 或任何语义模型（仍是纯关键词 + 规则）。
- 不改生产 `driver.mjs`、前端、Rust 后端、用户作品。
- 不做三试（下一个 change）、不做人工复核 UI（第三个 change）。

## Decisions

### D1 评分前剥离 markdown（修缺陷 6 的一部分）

根因：模型回答带 `**加粗**`、`> 引用` 等 markdown，会把「**不在**印刷厂工作」里的「在印刷厂工作」用 `**` 打断，导致 `mustNegate`/`mustContain` 匹配失败（案例 30k-11）。修复：评分前剥掉常见 markdown 标记（`**`、`*`、`>`、`#`、反引号等），只对纯文本评分；证据仍保存原始回答。

### D2 引文的非对称处理（修缺陷 3）

根因：`mustContain` 与 `wrongConclusions` 共用「未引用才算断言」，导致模型引用原文作答（「去了城西的出版社」）不算命中 `mustContain`。修复：`mustContain` 改为「出现即命中」（含引用，只要未被否定）；`wrongConclusions` 与 `mustNegate` 保持「引用不算断言」。理由：引用正确事实作答 = 模型自己的结论；引用错误结论 ≠ 模型自己的断言。该非对称是安全的——只让"该通过"的更可能通过。

### D3 扩充不确定词表（修缺陷 4）

根因：只认「未知/未提及」等固定词，不认「无法得知/没有提供/没有出现/文中没有」。修复：扩充 `EXPLICIT_UNKNOWN_MARKERS`（加 无法得知、没有提供、没有出现、文中没有、未提供、不存在 等）。

### D4 推断措辞不再盲目阻断（修缺陷 5）

根因：`hedge`（可能/推断/似乎…）一出现就 `NEEDS_REVIEW`，哪怕结论其实明确（「可推断陆芸是陆远的母亲」）。修复：把「答案含推断措辞」和「结论本身不确定」分开。当事实边界已明确命中（`mustContain` 全中、无错误结论、`mustNegate` 满足）时，单有「可推断」不再阻断；结论确实模糊（`mustContain` 未命中，或出现「可能 X 也可能 Y」二选一）时仍 `NEEDS_REVIEW`。

### D5 裁判键写完整命题（修缺陷 1、2）

根因：`wrongConclusions`/`mustNegate` 写裸称谓词（「侄子」）或缺主语谓词（「住在盐城」），会被正确回答里的同类词误匹配（「外甥/侄子一类」「住在盐城的是苏蔓」）。修复：扩展既有「命题短语」规范——裸亲属称谓（侄子/儿子/兄弟）、裸职业词（医生/教师）、缺主语谓词（住在盐城）都要写完整命题（「沈砚是林秀兰的侄子」「苏晚住在盐城」）。同步改 `story-specs.mjs` 生成、`validate.mjs` 校验、重新生成 `oracle/*.json`。

### D6 裁判键不把材料未确定的结论当唯一答案（修缺陷 7）

根因：案例 03 问「沈砚和林秀兰什么关系」，材料只写「表哥、母亲这边亲戚」，推不出唯一的「外甥」，裁判键却把「外甥」当唯一 `mustContain`。修复：这类「材料未唯一确定」的关系题，`mustContain` 放宽为「外甥/侄子」都算命中，或改用 `allowedUncertainty` 接受「一类、未明确」的回答。实现时重设计案例 03 的 `expect`，以不冤枉模型、不引入新误标为准。

### D7 离线重评（验证手段）

根因：验证评分器修复若重跑 API 要花钱。修复：新增 `rescore.mjs`，读已保存证据的 `response.text` + 对应案例的 `expect`，用新 `screenAnswer` 重评，输出新结果分布。作为本 change 的验收手段，目标：0 假 `FAIL_LIKELY`、`NEEDS_REVIEW` 大幅下降。

## Risks / Trade-offs

- [D2 让引文计入 mustContain，可能误 PASS] → 缓解：仅对 mustContain 放宽，wrongConclusions/mustNegate 仍保守；引文若被否定仍不算命中。
- [D4 减少推断阻断，可能误 PASS] → 缓解：只在事实边界明确命中时放宽，二选一/模糊仍 `NEEDS_REVIEW`。
- [整体削弱保守立场] → 缓解：所有改动只针对已确认的误标模式；新增单元测试覆盖 7 类缺陷；离线重评 66 份证据确认误标下降、无新增假 PASS/FAIL。
- [markdown 剥离误伤含 `*` 的正常文本] → 缓解：只剥常见 markdown 标记，且只用于评分、不用于保存。

## Open Questions

- D6 里案例 03 的具体改法（放宽 mustContain vs 改 allowedUncertainty）在实现时定，以不冤枉模型、不引入新误标为准。
