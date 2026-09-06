// ids.mjs — 运行/案例标识的安全校验（@dsh-reliability/core）
// runId / caseId 会被拼进证据输出路径（<outputDir>/<runId>/cases/<caseId>.json），
// 必须限制为安全文件名，拒绝路径穿越、绝对路径、盘符与空值。
// 规则：非空字符串，首字符为字母/数字，其后仅允许字母/数字、点、下划线、连字符。
// 这排除了 "/"、"\\"、".."、前导点隐藏名、空字符串与 Windows 盘符等越界写法。

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 判断标识是否为安全文件名。 */
export function isSafeFilenameId(id) {
  return typeof id === "string" && SAFE_ID_RE.test(id);
}

/** 断言 runId 为安全文件名，否则抛出 TypeError（中文）。 */
export function assertSafeRunId(runId) {
  if (!isSafeFilenameId(runId)) {
    throw new TypeError(`runId 必须是安全文件名（字母/数字开头，仅含字母数字、点、下划线、连字符）：${JSON.stringify(runId)}`);
  }
}

/** 断言 caseId 为安全文件名，否则抛出 TypeError（中文）。 */
export function assertSafeCaseId(caseId) {
  if (!isSafeFilenameId(caseId)) {
    throw new TypeError(`案例 id 必须是安全文件名（字母/数字开头，仅含字母数字、点、下划线、连字符）：${JSON.stringify(caseId)}`);
  }
}

/**
 * 校验案例数组：每个 case.id 必须安全，且 id 不得重复。
 * 返回重复 id 列表（空数组表示无重复）。不安全的 id 直接抛 TypeError。
 */
export function assertSafeCaseIds(cases) {
  const seen = new Set();
  const duplicates = [];
  for (const c of cases) {
    assertSafeCaseId(c?.id);
    if (seen.has(c.id)) duplicates.push(c.id);
    seen.add(c.id);
  }
  if (duplicates.length > 0) {
    throw new TypeError(`重复的案例 id（每个案例 id 必须唯一）：${[...new Set(duplicates)].join("、")}`);
  }
  return duplicates;
}
