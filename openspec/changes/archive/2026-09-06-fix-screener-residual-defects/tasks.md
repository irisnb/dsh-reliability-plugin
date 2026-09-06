## 1. 评分器修复（screening.mjs）

- [x] 1.1 评分前剥离 markdown 标记（`**`、`*`、`>`、`#`、反引号），使「**不在**印刷厂工作」能被识别为「不在印刷厂工作」；证据仍保存原始回答（design D1）
- [x] 1.2 `mustContain` 采用非对称引文处理：出现即命中（含引用、只要未被否定）；`wrongConclusions`/`mustNegate` 保持「引用不算断言」（design D2）
- [x] 1.3 扩充 `EXPLICIT_UNKNOWN_MARKERS`：加 无法得知、没有提供、没有出现、文中没有、未提供、不存在 等（design D3）
- [x] 1.4 推断措辞不再盲目阻断：事实边界已明确命中（mustContain 全中、无错误结论、mustNegate 满足）时，单有「可推断/可能」不触发 NEEDS_REVIEW；结论模糊（mustContain 未命中或二选一表达）仍复核（design D4）

## 2. 裁判键与校验修复（story-specs.mjs + validate.mjs + oracle）

- [x] 2.1 `story-specs.mjs` 把裸亲属称谓（侄子/儿子/兄弟）、裸职业词（医生/教师）、缺主语谓词（住在盐城）改写为完整命题（如「沈砚是林秀兰的侄子」「苏晚住在盐城」）（design D5）
- [x] 2.2 `story-specs.mjs` 修正案例 03 出题过严：材料未唯一确定的「外甥」不再当唯一 mustContain，改为允许「外甥/侄子一类、材料未明确」（design D6）
- [x] 2.3 `validate.mjs` 校验强化：`mustNegate`/`wrongConclusions` 出现裸亲属称谓、裸职业词、缺主语谓词时标记为非法边界短语
- [x] 2.4 运行 `generator.mjs` 重新生成 `oracle/*.json`，`validate.mjs` 离线校验全绿，`generator.mjs --check` 一致

## 3. 离线重评脚本

- [x] 3.1 新增 `rescore.mjs`：读已保存证据的 `response.text` 与对应案例的 `expect`，用新 `screenAnswer` 重评，输出新结果分布（design D7）

## 4. 单元测试

- [x] 4.1 `screening.test.mjs` 新增 7 类缺陷回归用例：markdown 剥离、引文命中 mustContain、不确定同义、推断措辞不阻断、裸称谓词、缺主语谓词、出题过严
- [x] 4.2 新增/更新 validate 相关用例：拒绝裸称谓词与缺主语谓词

## 5. 验收

- [x] 5.1 `npm run test:reliability` 全绿（含新增用例）
- [x] 5.2 用 `rescore.mjs` 离线重评已保存的 66 份证据：0 假 `FAIL_LIKELY`、复杂自然语言继续保守进入 `NEEDS_REVIEW`、无新增假 PASS/FAIL
- [x] 5.3 更新 `.omo/长上下文幻觉压力测试汇总-2026-09-06.md` 与 `docs/answer-reliability-tester.md`，记录修复后重评结果与剩余误标
