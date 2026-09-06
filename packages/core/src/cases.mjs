// cases.mjs — 案例加载与校验（@dsh-reliability/core）
// loadCases 直接复用 schema.mjs 的 loadAndValidate / validateCase，不复制校验规则。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { loadAndValidate, validateCase } from "./schema.mjs";

/**
 * 加载并校验案例源。
 * @param {string|object[]} source 案例源文本（JSON / JSONL）或案例对象数组。
 * @returns {{ valid: Array<{case:object,index:number}>, invalid: Array<{case:object,index:number,errors:string[]}>, parseError: string|null }}
 *   valid/invalid 与 sidecar/reliability/schema.mjs 的 loadAndValidate 形状一致。
 */
export function loadCases(source) {
  if (Array.isArray(source)) {
    const valid = [];
    const invalid = [];
    source.forEach((c, index) => {
      const r = validateCase(c);
      if (r.ok) valid.push({ case: c, index });
      else invalid.push({ case: c, index, errors: r.errors });
    });
    return { valid, invalid, parseError: null };
  }
  return loadAndValidate(String(source));
}

/** 解析案例路径：单文件返回自身，目录返回按名字排序的 *.json / *.jsonl 文件列表。 */
export function resolveCaseFiles(casesPath) {
  const st = statSync(casesPath);
  if (st.isFile()) return [casesPath];
  return readdirSync(casesPath)
    .filter((n) => [".json", ".jsonl"].includes(extname(n).toLowerCase()))
    .sort()
    .map((n) => join(casesPath, n));
}

/**
 * 从文件/目录加载案例（供 CLI 与测试使用）。每个合法/非法条目附带 source 字段（来源文件）。
 * @returns {{ valid:Array, invalid:Array, parseError:string|null, files:string[] }}
 */
export function loadCasesFromFiles(casesPath) {
  const files = resolveCaseFiles(casesPath);
  const valid = [];
  const invalid = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const r = loadCases(source);
    if (r.parseError) {
      invalid.push({ case: { id: file }, index: -1, errors: [`解析失败：${r.parseError}`], source: file });
      continue;
    }
    for (const v of r.valid) valid.push({ case: v.case, index: v.index, source: file });
    for (const v of r.invalid) invalid.push({ case: v.case, index: v.index, source: file, errors: v.errors });
  }
  return { valid, invalid, parseError: null, files };
}
