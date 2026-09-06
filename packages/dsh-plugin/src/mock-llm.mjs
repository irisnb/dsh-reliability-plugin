// mock-llm.mjs — 测试专用确定性 Mock LLM（@dsh-reliability/dsh-plugin）
// 只用于测试配置显式开启的场景，绝不影响普通 DSH 会话。未启用时 respond() 返回 null（只读观测）。
export function createMockLlm(options = {}) {
  const enabled = options.enabled === true;
  const responses = options.responses ?? {};
  const defaultPolicy = options.defaultPolicy ?? "echo-material";

  /**
   * 确定性回答。未启用返回 null；显式规则优先于默认策略。
   * @param {{text:string, material?:object}} input
   */
  function respond(input = {}) {
    if (!enabled) return null;
    const rule = responses[input.text];
    if (typeof rule === "function") return rule(input);
    if (typeof rule === "string") return rule;
    switch (defaultPolicy) {
      case "unknown":
        return "根据材料无法确定（材料未提及相关内容）。";
      case "empty":
        return "";
      case "echo-material":
      default:
        return input.material?.text ?? "";
    }
  }

  return { enabled, respond };
}
