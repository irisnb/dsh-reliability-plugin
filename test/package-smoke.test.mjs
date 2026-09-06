// package-smoke.test.mjs — 干净安装/打包烟雾测试
// 覆盖评审阻塞项：
//   6) 从打包内容或 workspace 安装后的 CLI 可以执行 --mode mock，且不依赖尚未发布的 registry 包
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

/** 在 Windows 上 npm 是 .cmd，需 shell 才能 spawn；Unix 直接执行 npm。 */
function runNpm(args, opts = {}) {
  return spawnSync(npmCmd, args, { shell: process.platform === "win32", encoding: "utf8", ...opts });
}

test("npm pack --dry-run --workspaces 成功", () => {
  const res = runNpm(["pack", "--dry-run", "--workspaces"], { cwd: root });
  assert.equal(res.status, 0, `pack dry-run 应成功：\nstdout=${res.stdout}\nstderr=${res.stderr}`);
});

test("CLI 包 tarball 内含 bin 与默认 fixture（自包含）", () => {
  const packDir = mkdtempSync(join(tmpdir(), "dsh-smoke-pack-"));
  try {
    const res = runNpm(["pack", "--workspace", "dsh-reliability-plugin", "--pack-destination", packDir, "--json"], { cwd: root });
    assert.equal(res.status, 0, `pack 应成功：\nstdout=${res.stdout}\nstderr=${res.stderr}`);
    const parsed = JSON.parse(res.stdout);
    const files = (Array.isArray(parsed) ? parsed[0] : parsed).files.map((f) => f.path);
    assert.ok(files.includes("bin/dsh-reliability.mjs"), "tarball 含 bin");
    assert.ok(files.includes("fixtures/basic.jsonl"), "tarball 含默认 fixture");
  } finally {
    rmSync(packDir, { recursive: true, force: true });
  }
});

test("打包安装 core+plugin+cli 后 CLI 可执行 doctor 与 run --mode mock（不依赖 registry）", () => {
  const packDir = mkdtempSync(join(tmpdir(), "dsh-inst-pack-"));
  const projDir = mkdtempSync(join(tmpdir(), "dsh-inst-proj-"));
  try {
    for (const ws of ["@dsh-reliability/core", "@dsh-reliability/dsh-plugin", "dsh-reliability-plugin"]) {
      const res = runNpm(["pack", "--workspace", ws, "--pack-destination", packDir], { cwd: root });
      assert.equal(res.status, 0, `pack ${ws} 应成功：${res.stderr}`);
    }
    const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz")).map((f) => join(packDir, f));
    assert.equal(tarballs.length, 3, "打包出 core、plugin 与 cli 三个 tarball");

    writeFileSync(join(projDir, "package.json"), JSON.stringify({ name: "smoke", private: true, version: "1.0.0" }), "utf8");
    const install = runNpm(["install", "--no-audit", "--no-fund", ...tarballs], { cwd: projDir });
    assert.equal(install.status, 0, `安装 tarball 应成功：\nstdout=${install.stdout}\nstderr=${install.stderr}`);

    const bin = join(projDir, "node_modules", "dsh-reliability-plugin", "bin", "dsh-reliability.mjs");
    assert.ok(existsSync(bin), "安装后 bin 存在");

    // doctor 应从已安装 node_modules 解析插件版本（不依赖仓库根 packages 路径）
    const doctor = spawnSync(process.execPath, [bin, "doctor"], { cwd: projDir, encoding: "utf8" });
    assert.equal(doctor.status, 0, `doctor 应通过：\nstdout=${doctor.stdout}\nstderr=${doctor.stderr}`);
    assert.match(doctor.stdout, /@dsh-reliability\/dsh-plugin 版本/, "doctor 从已安装包解析插件版本");

    const init = spawnSync(process.execPath, [bin, "init"], { cwd: projDir, encoding: "utf8" });
    assert.equal(init.status, 0, `init 应成功：${init.stderr}`);

    const run = spawnSync(process.execPath, [bin, "run", "--mode", "mock", "--run-id", "inst-run"], { cwd: projDir, encoding: "utf8" });
    assert.equal(run.status, 0, `run --mode mock 应成功：\nstdout=${run.stdout}\nstderr=${run.stderr}`);
    assert.ok(existsSync(join(projDir, "artifacts", "runs", "inst-run", "manifest.json")), "产出证据");
  } finally {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(projDir, { recursive: true, force: true });
  }
});
