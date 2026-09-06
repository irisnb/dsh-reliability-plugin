// cli-usage.test.mjs — CLI/config 参数 fail-fast 回归测试
// 覆盖评审阻塞项：
//   4) 配置字段类型/值域检查；缺少 --model/--api-base 等值时报中文 usage error；未知参数拒绝；doctor 检查输出目录可写
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "packages", "cli", "bin", "dsh-reliability.mjs");

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd ?? root,
    env: opts.env ?? { ...process.env, DEEPSEEK_API_KEY: "" },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

test("--model 缺少值时中文 usage 报错退出码 2", () => {
  const r = run(["run", "--mode", "mock", "--model"]);
  assert.equal(r.code, 2, `stderr=${r.stderr}`);
  assert.match(r.stderr, /--model/);
});

test("--api-base 缺少值时中文 usage 报错退出码 2", () => {
  const r = run(["run", "--mode", "mock", "--api-base"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--api-base/);
});

test("未知参数被拒绝退出码 2", () => {
  const r = run(["run", "--mode", "mock", "--bogus", "x"]);
  assert.equal(r.code, 2, `stderr=${r.stderr}`);
  assert.match(r.stderr, /未知参数/);
});

test("配置字段类型/值域错误 fail-fast（无效 mode）", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-usage-"));
  try {
    writeFileSync(join(tmp, "dsh-reliability.config.json"), JSON.stringify({ mode: "bogus", model: 123 }), "utf8");
    const r = run(["run"], { cwd: tmp });
    assert.equal(r.code, 2, `stderr=${r.stderr}`);
    assert.match(r.stderr, /配置/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("配置 JSON 解析失败 fail-fast（中文报错）", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-usage-"));
  try {
    writeFileSync(join(tmp, "dsh-reliability.config.json"), "{ not valid json", "utf8");
    const r = run(["run"], { cwd: tmp });
    assert.equal(r.code, 2, `stderr=${r.stderr}`);
    assert.match(r.stderr, /配置/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("doctor 检查输出目录可写：不可写时报 FAIL 且退出码 1", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-doc-"));
  try {
    // 用一个已存在的文件挡住 out 目录创建
    writeFileSync(join(tmp, "blocked"), "x", "utf8");
    writeFileSync(join(tmp, "dsh-reliability.config.json"), JSON.stringify({ out: "blocked/runs" }), "utf8");
    const r = run(["doctor"], { cwd: tmp });
    assert.equal(r.code, 1, `doctor 应失败，stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /输出目录/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("doctor 检查输出目录可写：正常目录 PASS 且退出码 0", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-doc-ok-"));
  try {
    mkdirSync(join(tmp, "outdir"), { recursive: true });
    writeFileSync(join(tmp, "dsh-reliability.config.json"), JSON.stringify({ out: "outdir" }), "utf8");
    const r = run(["doctor"], { cwd: tmp });
    assert.equal(r.code, 0, `doctor 应通过，stdout=${r.stdout}\nstderr=${r.stderr}`);
    assert.match(r.stdout, /输出目录/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
