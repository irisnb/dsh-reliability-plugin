// cli.test.mjs — CLI 测试：help / init / doctor / run --mode mock / 缺 key 中文报错与退出码。
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "packages", "cli", "bin", "dsh-reliability.mjs");
const FIXTURES = join(root, "fixtures", "basic.jsonl");

function cleanEnv() {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  return env;
}

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: opts.cwd ?? root,
    env: opts.env ?? cleanEnv(),
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

test("--help 列出 init / doctor / run 且退出码 0", () => {
  const r = run(["--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /init/);
  assert.match(r.stdout, /doctor/);
  assert.match(r.stdout, /run/);
});

test("doctor 离线自检退出码 0", () => {
  const r = run(["doctor"]);
  assert.equal(r.code, 0, `doctor 应离线通过，stderr=${r.stderr}`);
  assert.match(r.stdout, /Node\.js/);
});

test("init 在目标目录生成配置文件", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-init-"));
  try {
    const r = run(["init"], { cwd: tmp });
    assert.equal(r.code, 0);
    assert.ok(existsSync(join(tmp, "dsh-reliability.config.json")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("run --mode mock 离线产出完整证据且退出码 0", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-cli-"));
  try {
    const r = run(["run", "--mode", "mock", "--cases", FIXTURES, "--out", tmp, "--run-id", "cli-run"]);
    assert.equal(r.code, 0, `mock 运行应成功，stderr=${r.stderr}`);
    const runDir = join(tmp, "cli-run");
    assert.ok(existsSync(join(runDir, "manifest.json")));
    assert.ok(existsSync(join(runDir, "report.json")));
    assert.ok(existsSync(join(runDir, "report.html")));
    assert.ok(existsSync(join(runDir, "cases", "basic-fact.json")));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("run --mode real 缺 key 中文报错且退出码 2", () => {
  const r = run(["run", "--mode", "real"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /DEEPSEEK_API_KEY/);
});

test("run 未知模式退出码 2", () => {
  const r = run(["run", "--mode", "bogus"]);
  assert.equal(r.code, 2);
});

test("未知命令退出码 2 且打印帮助", () => {
  const r = run(["nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stdout, /init/);
});
