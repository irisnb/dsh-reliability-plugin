// clean-install.test.mjs — 干净安装与文档烟雾测试：README 命令、夹具路径、示例配置、脚本与发布文件一致性。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases } from "@dsh-reliability/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(p, "utf8");

const README_PATH = join(root, "docs", "dsh-reliability-plugin", "README.md");

test("README 第一屏给出 clone/install/doctor/离线运行/真实运行", () => {
  assert.ok(existsSync(README_PATH), "插件项目 README 存在");
  const text = read(README_PATH);
  for (const needle of ["git clone", "npm install", "doctor", "--mode mock", "--mode real"]) {
    assert.ok(text.includes(needle), `README 应包含「${needle}」`);
  }
});

test("LICENSE 为 MIT，CHANGELOG 非空", () => {
  assert.ok(existsSync(join(root, "LICENSE")));
  assert.match(read(join(root, "LICENSE")), /MIT/);
  assert.ok(existsSync(join(root, "CHANGELOG.md")));
  assert.ok(read(join(root, "CHANGELOG.md")).trim().length > 0);
});

test("fixtures/basic.jsonl 全部通过校验", () => {
  const src = read(join(root, "fixtures", "basic.jsonl"));
  const { valid, invalid, parseError } = loadCases(src);
  assert.equal(parseError, null);
  assert.equal(invalid.length, 0, `无效案例：${JSON.stringify(invalid.map((i) => i.errors))}`);
  assert.equal(valid.length, 3);
});

test("examples/minimal-config.json 是合法配置且字段齐全", () => {
  const cfg = JSON.parse(read(join(root, "examples", "minimal-config.json")));
  for (const k of ["model", "mode", "cases", "out", "apiBase"]) {
    assert.ok(k in cfg, `配置缺少 ${k}`);
  }
  assert.equal(cfg.mode, "mock");
});

test("根 test 脚本引用的新测试文件都存在", () => {
  const pkg = JSON.parse(read(join(root, "package.json")));
  const names = ["package-layout", "core-api", "dsh-plugin", "cli", "clean-install"];
  for (const n of names) {
    assert.ok(existsSync(join(root, "test", `${n}.test.mjs`)), `test/${n}.test.mjs 存在`);
  }
  assert.ok(pkg.scripts.test.includes("test/*.test.mjs"));
});

test("GitHub Actions 离线工作流存在并引用 npm test", () => {
  const wf = join(root, ".github", "workflows", "test.yml");
  assert.ok(existsSync(wf));
  const text = read(wf);
  assert.match(text, /npm (ci|install)/);
  assert.match(text, /npm test/);
});

test("设计文档不引用不存在的 npm run doctor / npm run test:offline 脚本", () => {
  const design = join(root, "docs", "superpowers", "specs", "2026-09-06-dsh-reliability-plugin-design.md");
  assert.ok(existsSync(design), "设计文档存在");
  const text = read(design);
  assert.ok(!text.includes("npm run doctor"), "不得引用不存在的 npm run doctor");
  assert.ok(!text.includes("npm run test:offline"), "不得引用不存在的 npm run test:offline");
  // 设计文档应给出可执行的 npx/npm 命令
  assert.ok(text.includes("npx dsh-reliability doctor"), "设计文档使用实际 npx 命令");
});
