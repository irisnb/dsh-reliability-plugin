// dsh-plugin-provide.test.mjs — 插件 Cordis provide 服务生命周期回归测试
// 覆盖评审阻塞项：
//   3) 保存 ctx.provide 返回的 disposer 并在 dispose 中调用；不无条件吞掉重复注册错误（仅忽略重复注册，其余重抛）
import assert from "node:assert/strict";
import test from "node:test";

import { apply } from "@dsh-reliability/dsh-plugin";

test("apply 保存 provide 返回的 disposer，并在 dispose() 时调用", () => {
  let disposed = false;
  const ctx = {
    on: () => () => {},
    provide: (k, v) => {
      assert.equal(k, "reliability.probe");
      assert.equal(v.name, "reliability-probe");
      return () => { disposed = true; };
    },
  };
  const api = apply(ctx, {});
  assert.equal(disposed, false, "尚未 dispose");
  api.dispose();
  assert.equal(disposed, true, "dispose() 应调用 provide 返回的 disposer");
});

test("同名服务重复注册错误被明确处理而不重抛（幂等加载）", () => {
  const ctx = {
    on: () => () => {},
    provide: () => { throw new Error('service "reliability.probe" has been registered at <other>'); },
  };
  const api = apply(ctx, {});
  assert.ok(api, "重复注册不应导致 apply 抛出");
  assert.equal(api.name, "reliability-probe");
});

test("非重复注册错误不被吞掉，向上抛出", () => {
  const ctx = {
    on: () => () => {},
    provide: () => { throw new Error("unexpected internal failure"); },
  };
  assert.throws(() => apply(ctx, {}), /unexpected internal failure/);
});
