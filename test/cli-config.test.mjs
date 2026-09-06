// cli-config.test.mjs — CLI 使用 init 生成配置与包内默认 fixture 的回归测试
// 覆盖评审阻塞项：
//   4) run 使用 init 生成的 cases/out/model/apiBase 配置；默认 fixture 在 CLI 安装路径可找到（不依赖仓库根）
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCasesPath } from "../packages/cli/src/config.mjs";
import { materialHash } from "@dsh-reliability/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(root, "packages", "cli", "bin", "dsh-reliability.mjs");
const CLI_BUNDLED_FIXTURE = join(root, "packages", "cli", "fixtures", "basic.jsonl");

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

test("CLI 包内含默认 fixture（安装路径可找到，不依赖仓库根）", () => {
  assert.ok(existsSync(CLI_BUNDLED_FIXTURE), "packages/cli/fixtures/basic.jsonl 存在");
  const tmp = mkdtempSync(join(tmpdir(), "dsh-resolve-"));
  try {
    // 从不含 fixture 的 cwd 解析默认 fixture，仍应命中 CLI 包内的副本
    const p = resolveCasesPath(undefined, tmp);
    assert.ok(p, "默认 fixture 可解析");
    assert.equal(p, CLI_BUNDLED_FIXTURE, "解析到 CLI 包内 fixture，而非仓库根");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("run 使用 init 生成的 out 配置", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-cfg-out-"));
  try {
    writeFileSync(
      join(tmp, "dsh-reliability.config.json"),
      JSON.stringify({ model: "deepseek-v4-pro", mode: "mock", cases: "fixtures/basic.jsonl", out: "custom-runs", apiBase: "https://api.deepseek.com" }),
      "utf8",
    );
    const r = run(["run", "--mode", "mock", "--run-id", "cfg-run"], { cwd: tmp });
    assert.equal(r.code, 0, `stderr=${r.stderr}`);
    assert.ok(existsSync(join(tmp, "custom-runs", "cfg-run", "manifest.json")), "输出到配置的 out 目录");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("run 使用 init 生成的 cases 配置（自定义案例文件）", () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-cfg-cases-"));
  try {
    const customFixture = join(tmp, "my-cases", "custom.jsonl");
    mkdirSync(join(tmp, "my-cases"), { recursive: true });
    const materialText = "黄昏镇在河谷西岸。老陈在镇口开了一间茶馆。";
    writeFileSync(customFixture, JSON.stringify({
      id: "custom-case",
      material: { name: "黄昏镇", version: "1", hash: materialHash(materialText), text: materialText },
      question: "老陈在镇上做什么？",
      expect: {
        factBoundary: { mustContain: ["开了一间茶馆"], mustNegate: [] },
        wrongConclusions: [],
        allowedUncertainty: [],
        evidenceLocations: ["第一句"],
        riskTags: ["fact-boundary"],
      },
    }) + "\n", "utf8");
    writeFileSync(
      join(tmp, "dsh-reliability.config.json"),
      JSON.stringify({ model: "deepseek-v4-pro", mode: "mock", cases: "my-cases/custom.jsonl", out: "artifacts/runs", apiBase: "https://api.deepseek.com" }),
      "utf8",
    );
    const r = run(["run", "--mode", "mock", "--run-id", "cfg-cases-run"], { cwd: tmp });
    assert.equal(r.code, 0, `stderr=${r.stderr}`);
    assert.ok(existsSync(join(tmp, "artifacts", "runs", "cfg-cases-run", "cases", "custom-case.json")), "运行了配置指定的案例文件");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
