// cli-modes.test.mjs — CLI 模式选择回归测试
// 覆盖评审阻塞项：
//   1) real 模式 = 真实 JSONL DSH 驱动（缺 driver 时中文报错），api 模式 = 兼容 API 测试器（非 DSH 测试）
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "packages", "cli", "bin", "dsh-reliability.mjs");

function run(args, env = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

test("real 模式缺 DEEPSEEK_API_KEY 中文报错退出码 2", () => {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  const r = run(["run", "--mode", "real"], env);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /DEEPSEEK_API_KEY/);
});

test("real 模式有 key 但缺驱动脚本时中文报错并提示 api 模式", () => {
  const r = run(["run", "--mode", "real"], { DEEPSEEK_API_KEY: "sk-test-12345678" });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--driver|DSH_DRIVER_PATH/);
  assert.match(r.stderr, /--mode api/);
});

test("api 模式被识别为兼容 API 测试器（非 DSH），缺 key 时报 DEEPSEEK_API_KEY", () => {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  const r = run(["run", "--mode", "api"], env);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /DEEPSEEK_API_KEY/);
});
