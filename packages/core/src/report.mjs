// report.mjs — 自包含 HTML 报告渲染（@dsh-reliability/core）
// renderReportHtml 只接收已经脱敏的报告对象。脱敏统一由 evidence-store 在渲染前完成，
// 保证 report.html 与 report.json 使用同一份脱敏数据，任何理由/错误文本含 key 也不泄漏。

/** HTML 转义（report.html 安全渲染）。 */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

/** 生成自包含 report.html。入参 report 必须已脱敏。 */
export function renderReportHtml(report) {
  const rows = (report.cases ?? [])
    .map((c) => `<tr><td>${esc(c.case_id)}</td><td class="r-${esc(c.result)}">${esc(c.result)}</td><td>${esc((c.reasons ?? []).join("；"))}</td></tr>`)
    .join("\n");
  const c = report.counts ?? {};
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>DSH 可靠性测试报告 ${esc(report.run_id)}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { border: 1px solid #ddd; padding: .5rem .75rem; text-align: left; }
  th { background: #f5f5f5; }
  .r-PASS_LIKELY { color: #1a7f37; }
  .r-FAIL_LIKELY { color: #c62828; }
  .r-RUNTIME_ERROR { color: #b26a00; }
  .r-NEEDS_REVIEW { color: #6a1b9a; }
  .counts { display: flex; gap: 1rem; flex-wrap: wrap; }
  .counts span { background: #f0f0f0; padding: .25rem .75rem; border-radius: 1rem; }
</style>
</head>
<body>
<h1>DSH 回答可靠性测试报告</h1>
<p>run_id: <code>${esc(report.run_id)}</code> · 生成时间: ${esc(report.generated_at)}</p>
<p>配置: model=${esc(report.configuration?.model)} · api_base=${esc(report.configuration?.api_base)} · mode=${esc(report.configuration?.mode)}</p>
<div class="counts">
  <span>total=${c.total ?? 0}</span>
  <span>pass_likely=${c.pass_likely ?? 0}</span>
  <span>fail_likely=${c.fail_likely ?? 0}</span>
  <span>needs_review=${c.needs_review ?? 0}</span>
  <span>runtime_error=${c.runtime_error ?? 0}</span>
</div>
<table>
<thead><tr><th>案例</th><th>自动结果</th><th>理由</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}
