// package-layout.test.mjs — 发布包骨架测试：包存在、bin 可解析、DSH 版本精确、workspaces 正确。
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("三个发布包存在且为 ESM", () => {
  for (const name of ["core", "dsh-plugin", "cli"]) {
    const pkg = readJson(join(root, "packages", name, "package.json"));
    assert.equal(pkg.type, "module", `${name} 应为 ESM`);
    assert.ok(pkg.version, `${name} 需要 version`);
  }
});

test("CLI 包声明 dsh-reliability bin 且入口可执行", () => {
  const cliPkg = readJson(join(root, "packages", "cli", "package.json"));
  assert.deepEqual(cliPkg.bin, { "dsh-reliability": "bin/dsh-reliability.mjs" });
  const bin = join(root, "packages", "cli", "bin", "dsh-reliability.mjs");
  assert.ok(existsSync(bin), "bin 文件存在");
  assert.match(readFileSync(bin, "utf8"), /#!\/usr\/bin\/env node/);
});

test("dsh-plugin 精确声明 @deepseek-ai/dsh 0.1.0-rc.7 为可选 peer 依赖", () => {
  const pkg = readJson(join(root, "packages", "dsh-plugin", "package.json"));
  assert.equal(pkg.peerDependencies?.["@deepseek-ai/dsh"], "0.1.0-rc.7");
  assert.equal(pkg.peerDependenciesMeta?.["@deepseek-ai/dsh"]?.optional, true);
});

test("根 package.json 使用 workspaces 且 test 脚本覆盖新测试与 reliability 测试", () => {
  const pkg = readJson(join(root, "package.json"));
  assert.deepEqual(pkg.workspaces, ["packages/*"]);
  assert.ok(pkg.scripts.test, "存在 test 脚本");
  assert.match(pkg.scripts.test, /test:reliability/);
  assert.match(pkg.scripts.test, /test\/\*\.test\.mjs/);
});

test("core 公共 API 可通过包名解析", async () => {
  const mod = await import("@dsh-reliability/core");
  for (const k of ["loadCases", "screenAnswer", "createEvidenceStore", "runReliability", "MockAdapter"]) {
    assert.equal(typeof mod[k], "function", `core 导出 ${k}`);
  }
});

test("dsh-plugin 通过包名解析并导出标准 Cordis 契约", async () => {
  const mod = await import("@dsh-reliability/dsh-plugin");
  assert.equal(typeof mod.apply, "function");
  assert.equal(typeof mod.default, "function");
  assert.equal(typeof mod.name, "string");
  assert.ok(Array.isArray(mod.inject));
});
