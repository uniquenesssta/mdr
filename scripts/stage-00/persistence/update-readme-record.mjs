const STAGE0_ENTRY_PATTERN = /<!-- stage-00-run:[^>]+ -->\n- [^\n]*\n/g;

function failedCheckIds(summary) {
  return [
    ...(summary.requiredFailures || []),
    ...(summary.extendedFailures || [])
  ].map(record => `\`${record.id}\``).join('、');
}

export function renderStage0ReadmeEntry({ date, runId, runAttempt, summary }) {
  const marker = `<!-- stage-00-run:${runId}:${runAttempt} -->`;
  if (summary.stageGate === 'passed') {
    return `${marker}\n- ${date}：阶段 0 基线阻塞修复完成并通过 GitHub Actions 完整门禁（run ${runId}）：Node 测试、浏览器契约、应用浏览器回归 7/7、前端构建、Rust test/check 与 Tauri Linux release build 全部通过；最低 Rust 工具链调整为 1.88.0，冻结模型和公共契约未改变。阶段 0 完成，阶段 1 尚未开始。\n`;
  }
  const failures = failedCheckIds(summary) || '未解析检查';
  return `${marker}\n- ${date}：阶段 0 GitHub Actions 基线验证未通过（run ${runId}），失败检查：${failures}；阶段 1 未开始。\n`;
}

export function updateStage0Readme(readme, entry) {
  const cleaned = String(readme || '').replace(STAGE0_ENTRY_PATTERN, '');
  const heading = '## Change Log';
  const headingIndex = cleaned.indexOf(heading);
  if (headingIndex < 0) return `${cleaned.trimEnd()}\n\n${heading}\n${entry}`;
  const lineEnd = cleaned.indexOf('\n', headingIndex + heading.length);
  const insertAt = lineEnd >= 0 ? lineEnd + 1 : cleaned.length;
  return `${cleaned.slice(0, insertAt)}${entry}${cleaned.slice(insertAt)}`;
}
