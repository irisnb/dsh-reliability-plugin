// driver-client.mjs — 真实 DSH 驱动的 JSONL 客户端（@dsh-reliability/core）
// 复用 sidecar/reliability/driver-client.mjs 的 JSONL 协议（start_session / replay_history /
// replay_done / send_message / cancel_message / end_session / shutdown；ready / session_started /
// replay_ok / delta / message_done / message_failed / session_ended / error）。
//
// 关键差异：本模块自包含，不依赖 Next Story sidecar 路径。驱动脚本路径由调用方注入
// （DriverAdapter 构造参数 driverPath），运行时只负责进程生命周期、JSONL 收发、每步超时与终态处理。
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import readline from "node:readline";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export class DriverClient {
  constructor({ driverPath, apiBase, model, apiKey, home }) {
    if (!driverPath || typeof driverPath !== "string") {
      throw new Error("DriverClient 需要 driverPath（真实 DSH 驱动脚本路径）");
    }
    this.driverPath = driverPath;
    this.apiBase = apiBase;
    this.model = model;
    this.apiKey = apiKey;
    this.home = home;
    this.child = null;
    this.inbox = [];
    this.cursor = 0;
    this.exited = null;
    this.spawnError = null;
    this.rl = null;
    this.stderrChunks = [];
  }

  static async start(opts) {
    const client = new DriverClient(opts);
    try {
      await client.spawn();
      await client.waitReady();
      return client;
    } catch (err) {
      await client.dispose().catch(() => { /* 清理尽力而为 */ });
      throw err;
    }
  }

  spawn() {
    this.child = spawn(
      process.execPath,
      [this.driverPath, "--api-base", this.apiBase, "--model", this.model],
      {
        cwd: dirname(this.driverPath),
        env: {
          ...process.env,
          ...(this.apiKey ? { DEEPSEEK_API_KEY: this.apiKey } : {}),
          ...(this.home ? { DSH_HOME: this.home } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child.stderr.on("data", (d) => this.stderrChunks.push(d.toString()));
    this.child.on("exit", (code) => { this.exited = code; });
    // 关键：监听 spawn 失败（无效路径/不可执行/工作目录不存在），转为可 await/catch 的
    // 受控错误，避免未处理 error 事件导致堆栈崩溃。错误经 waitFor/waitReady 抛出。
    this.child.on("error", (err) => {
      const e = new Error(`driver 启动失败（${this.driverPath}）：${String(err?.message ?? err)}`);
      e.category = "driver_spawn_failed";
      e.code = err?.code;
      e.cause = err;
      this.spawnError = e;
    });
    this.rl = readline.createInterface({ input: this.child.stdout, terminal: false });
    this.rl.on("line", (line) => {
      try { this.inbox.push(JSON.parse(line)); } catch { /* 非协议输出忽略 */ }
    });
  }

  /** 清理子进程与 readline 资源（幂等；用于启动失败或停止时的收尾）。 */
  async dispose() {
    if (this.rl) {
      try { this.rl.close(); } catch { /* 忽略 */ }
      this.rl = null;
    }
    if (this.child) {
      if (this.exited === null) {
        try { this.child.kill(); } catch { /* 忽略 */ }
      }
      this.child = null;
    }
  }

  send(msg) {
    this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  async waitReady(timeoutMs = 60000) {
    return this.waitFor((e) => e.type === "ready", timeoutMs, "ready");
  }

  async waitFor(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.spawnError) throw this.spawnError;
      for (; this.cursor < this.inbox.length; this.cursor++) {
        const e = this.inbox[this.cursor];
        if (predicate(e)) { this.cursor++; return e; }
      }
      if (this.exited !== null) {
        const err = new Error(`driver 提前退出（code=${this.exited}）：等待 ${label} 失败`);
        err.category = "driver_exited_early";
        throw err;
      }
      await sleep(25);
    }
    const err = new Error(`等待 ${label} 超时（${timeoutMs}ms）`);
    err.category = "timeout";
    throw err;
  }

  async waitMessageDone(sessionId, messageId, timeoutMs) {
    const deltas = [];
    const terminal = await this.waitFor((e) => {
      if (e.type === "delta" && e.session_id === sessionId && e.message_id === messageId) deltas.push(e.text);
      if (e.type === "error" && (e.session_id === sessionId || e.message_id === messageId)) return true;
      return (e.type === "message_done" || e.type === "message_failed")
        && e.session_id === sessionId && e.message_id === messageId;
    }, timeoutMs, `message ${messageId}`);
    return { terminal, deltas, folded: deltas.join("") };
  }

  stderrText() {
    return this.stderrChunks.join("");
  }

  async shutdown(timeoutMs = 10000) {
    if (!this.child || this.exited !== null) return;
    try { this.send({ type: "shutdown" }); } catch { /* 尽力而为 */ }
    await new Promise((resolve) => {
      const timer = setTimeout(() => { try { this.child.kill(); } catch { /* 忽略 */ } resolve(); }, timeoutMs);
      this.child.on("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
}
