// seed.mjs — 材料作为种子历史注入（@dsh-reliability/core）
// 与 sidecar/reliability/driver-client.mjs 的 buildSeedTurns 保持一致：
// 真实适配器用这段种子把离线固定材料注入会话，Mock 适配器忽略它。
export function buildSeedTurns(material) {
  return [
    { role: "user", text: `请阅读以下材料，后续所有回答只依据这份材料：\n\n${material.text}` },
    { role: "assistant", text: "好的，我已阅读并记住这份材料。" },
  ];
}
