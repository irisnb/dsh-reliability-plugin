// fake-dsh-driver.mjs — 离线替身 DSH 驱动（测试专用，不 import 任何 @deepseek-ai/* 包）
// 模拟 sidecar/driver/driver.mjs 的 stdin/stdout JSONL 协议（v1），用于离线验证 DriverAdapter。
// 出站 ready/session_started/replay_ok/delta/message_done/message_failed/session_ended/error。
import readline from "node:readline";

const PROTOCOL_VERSION = 1;

// 固定回答：对应测试案例里 mustContain 的事实边界。
const CANNED_ANSWER = "林悦在城东的图书馆工作。";

function emit(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

emit({ type: "ready", protocol_version: PROTOCOL_VERSION });

const sessions = new Set();

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (line.trim() === "") return;
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    emit({ type: "error", code: "bad_request", message: "坏帧" });
    return;
  }

  switch (cmd.type) {
    case "start_session":
      sessions.add(cmd.session_id);
      emit({ type: "session_started", session_id: cmd.session_id });
      break;
    case "replay_history":
      // 替身不真正注入历史，仅确认收到。
      break;
    case "replay_done":
      emit({ type: "replay_ok", session_id: cmd.session_id });
      break;
    case "send_message": {
      if (!sessions.has(cmd.session_id)) {
        emit({ type: "error", session_id: cmd.session_id, code: "session_not_found", message: "会话不存在" });
        break;
      }
      // 模拟两段增量 + 完成
      emit({ type: "delta", session_id: cmd.session_id, message_id: cmd.message_id, seq: 0, text: CANNED_ANSWER.slice(0, 4) });
      emit({ type: "delta", session_id: cmd.session_id, message_id: cmd.message_id, seq: 1, text: CANNED_ANSWER.slice(4) });
      emit({ type: "message_done", session_id: cmd.session_id, message_id: cmd.message_id, text: CANNED_ANSWER });
      break;
    }
    case "cancel_message":
      // 替身：取消立即生效，产生 message_failed
      emit({ type: "message_failed", session_id: cmd.session_id, message_id: cmd.message_id, code: "cancelled", message: "生成已被取消" });
      break;
    case "end_session":
      sessions.delete(cmd.session_id);
      emit({ type: "session_ended", session_id: cmd.session_id });
      break;
    case "shutdown":
      process.exit(0);
      break;
    default:
      emit({ type: "error", code: "unknown", message: "未知消息" });
  }
});

rl.on("close", () => process.exit(0));
