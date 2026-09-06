// driver-adapter.test.mjs — 真实 JSONL DSH Driver Adapter 的离线替身验证
// 覆盖评审阻塞项：
//   1) real 模式使用真正 JSONL DSH Driver Adapter（自包含，不依赖 Next Story sidecar 路径），
//      可经离线替身（fake-dsh-driver.mjs）端到端验证协议，真实 DSH 容器/API 仍需外部验证。
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runReliability, DriverAdapter, DriverClient, materialHash } from "@dsh-reliability/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAKE_DRIVER = join(root, "test", "fixtures", "fake-dsh-driver.mjs");

function makeCase(id, text = "黄昏镇在河谷西岸。") {
  return {
    id,
    material: { name: "测试材料", version: "1", hash: materialHash(text), text },
    question: "林悦在哪里工作？",
    expect: {
      factBoundary: { mustContain: ["城东的图书馆"], mustNegate: [] },
      wrongConclusions: [],
      allowedUncertainty: [],
      evidenceLocations: ["第一句"],
      riskTags: ["test"],
    },
  };
}

test("DriverAdapter 通过离线替身端到端运行：会话/重放/增量/完成/结束协议完整", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-drv-"));
  try {
    const cases = [makeCase("drv-case")];
    const adapter = new DriverAdapter({
      driverPath: FAKE_DRIVER,
      apiBase: "https://api.invalid",
      model: "fake-model",
      apiKey: "sk-fake-key-12345678",
    });

    const result = await runReliability({
      cases,
      adapter,
      model: "fake-model",
      apiBase: "https://api.invalid",
      mode: "real",
      outputDir: tmp,
      runId: "drv-run",
      apiKey: "sk-fake-key-12345678",
    });

    assert.equal(result.counts.runtime_error, 0, "替身驱动应正常完成，无运行错误");
    assert.equal(result.counts.pass_likely, 1, "替身固定回答命中事实边界");

    const evidence = JSON.parse(readFileSync(join(result.evidenceDir, "cases", "drv-case.json"), "utf8"));
    assert.equal(evidence.protocol.outcome, "completed");
    assert.equal(evidence.protocol.terminal_state, "message_done");
    assert.ok(evidence.protocol.delta_count > 0, "delta_count 来自真实 JSONL 增量");
    assert.equal(evidence.response.text, "林悦在城东的图书馆工作。");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("DriverAdapter 缺少 driverPath 时构造即失败", () => {
  assert.throws(() => new DriverAdapter({ apiKey: "sk-x", apiBase: "https://x", model: "m" }), /driverPath/);
});

test("DriverAdapter 缺少 apiKey 时构造即失败", () => {
  assert.throws(() => new DriverAdapter({ driverPath: FAKE_DRIVER, apiBase: "https://x", model: "m" }), /apiKey|DEEPSEEK_API_KEY/);
});

test("DriverClient.start 对不存在的驱动路径稳定返回受控错误（不崩溃）", async () => {
  const missing = join(tmpdir(), "dsh-no-such-dir-xyz", "driver.mjs");
  await assert.rejects(
    () => DriverClient.start({ driverPath: missing, apiBase: "https://x", model: "m", apiKey: "sk-x" }),
    (err) => {
      assert.ok(err, "应返回受控错误");
      return err.category === "driver_spawn_failed" || err.category === "driver_exited_early" || err.code === "ENOENT";
    },
    "不存在路径应返回受控错误",
  );
});

test("DriverClient.start 对存在但不可启动的路径稳定返回受控错误", async () => {
  const tmp = mkdtempSync(join(tmpdir(), "dsh-bad-driver-"));
  try {
    const empty = join(tmp, "empty.mjs");
    writeFileSync(empty, "", "utf8");
    await assert.rejects(
      () => DriverClient.start({ driverPath: empty, apiBase: "https://x", model: "m", apiKey: "sk-x" }),
      (err) => err && err.category === "driver_exited_early",
      "存在但不可启动的路径应返回受控错误",
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
