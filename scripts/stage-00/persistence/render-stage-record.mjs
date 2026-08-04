function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function tailLines(value, count = 50) {
  return stripAnsi(value)
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(-count)
    .join('\n')
    .trim();
}

function renderCheckTable(records = []) {
  return records.map(record => (
    `| \`${record.id}\` | ${record.status} | ${record.exitCode ?? '-'} | ${record.durationMs ?? '-'} |`
  )).join('\n');
}

function renderFrozenModels(records = []) {
  return records.map(record => (
    `| \`${record.path}\` | ${record.lines ?? '-'} | \`${record.sha256 || 'missing'}\` | ${record.scope} |`
  )).join('\n');
}

function commandVersion(environment, key, fallback = 'unknown') {
  return String(environment?.environmentCommands?.[key]?.stdout || fallback).trim();
}

function renderFailureSection({ summary, browserLog, cargoTestLog, cargoCheckLog, tauriBuildLog }) {
  const failures = [
    ...(summary.requiredFailures || []),
    ...(summary.extendedFailures || [])
  ];
  const browserFailures = stripAnsi(browserLog)
    .split('\n')
    .filter(line => line.includes('not ok - '))
    .map(line => line.slice(line.indexOf('not ok - ') + 'not ok - '.length).trim());

  return `## 未通过检查

${failures.map(record => `- \`${record.id}\`：退出码 ${record.exitCode ?? '-'}。`).join('\n') || '- 未能解析失败检查。'}

${browserFailures.length ? `### 浏览器失败用例\n\n${browserFailures.map(item => `- ${item}`).join('\n')}\n` : ''}
<details>
<summary>浏览器日志末尾</summary>

\`\`\`text
${tailLines(browserLog, 70)}
\`\`\`
</details>

<details>
<summary>Rust / Tauri 日志末尾</summary>

\`\`\`text
${tailLines(cargoTestLog || cargoCheckLog, 35)}
${tailLines(tauriBuildLog, 35)}
\`\`\`
</details>

## 阶段结论

阶段 0 硬性门禁尚未通过，阶段 1 不得开始。`;
}

function renderPassedSection() {
  return `## 已解决的基线阻塞

- 将项目声明的最低 Rust 工具链调整为 1.88.0，并由 Actions 从 \`src-tauri/Cargo.toml\` 读取唯一版本来源；未升级依赖、未改变 Rust 2021 edition。
- E2E 夹具改走应用文档生命周期，避免测试桥绕过文档身份、generation、预览重置与保存状态。
- 为虚拟化编辑器补齐测试目标范围定位，代码块、表格和 Mermaid 在交互前先稳定挂载。
- Mermaid 改为组件挂载后的下一帧开始异步渲染，避免未连接 DOM 被误判为取消。
- 修复源码编辑关闭路径缺少几何调度函数导入的问题。
- 围栏组件的展示替换范围不再吞掉文档末尾真实空行。
- 文档末尾空光标的活动源码样式只作用于最终行，不再因相邻边界判定同时高亮上一空行。
- Chromium 临时 profile 删除增加有界重试，避免全部用例通过后被文件系统清理竞态误判为失败。

## 行为与兼容性

- 冻结模型、块描述符、写回范围、公共接口、持久化格式和用户数据结构未改变。
- 代码块、Mermaid、表格、源码编辑与布局切换的既有交互语义保持不变。
- 工具链最低版本由 1.77.2 调整为 1.88.0；这是当前锁定依赖链的实际构建要求。

## 已知限制与非门禁警告

- 本次完整验证运行在 GitHub-hosted Ubuntu 22.04；Windows 原生窗口、文件关联和桌面拖放仍需后续在对应平台验证。
- \`npm ci\` 仍报告既有的 1 个 low、1 个 high audit 项，本阶段未擅自升级生产依赖。
- Vite 仍报告部分产物超过 500 kB；这是已记录的后续模块化与加载性能治理信号，不影响当前构建结果。

## 阶段结论

阶段 0 所有硬性检查与扩展检查均已通过，基线、契约和冻结模型证据已固定。阶段 0 完成；本节点没有开始阶段 1。`;
}

export function renderStageVerificationRecord(context) {
  const {
    summary,
    environment,
    frozenModels,
    tauriCommands,
    storageKeys,
    sourceManifest,
    trackedRuntimeOutput,
    browserLog,
    cargoTestLog,
    cargoCheckLog,
    tauriBuildLog,
    workflowName,
    runId,
    runAttempt,
    artifactName,
    checkoutBranch,
    checkoutSha
  } = context;

  const passed = summary.stageGate === 'passed';
  const title = passed
    ? '# 阶段 0 / 节点 00-03：基线阻塞修复与最终验证'
    : '# 阶段 0 / 节点 00-02：GitHub Actions 基线验证结果';
  const trackedOutputs = String(trackedRuntimeOutput || '').split(/\r?\n/).filter(Boolean);
  const annotatedCommands = (tauriCommands.annotated || []).map(record => record.name).sort();
  const handlerEntries = tauriCommands.invokeHandlerEntries || [];
  const largestSources = (sourceManifest || [])
    .filter(record => Number.isFinite(record.lines) && !record.path.startsWith('docs/'))
    .sort((left, right) => right.lines - left.lines)
    .slice(0, 12);

  return `${title}

## 节点状态

- 结果：**${passed ? '通过' : '失败'}**
- 阶段门禁：\`${summary.stageGate}\`
- 后续阶段：**${passed ? '阶段 0 已完成，阶段 1 尚未开始' : '禁止进入阶段 1'}**
- 工作流：\`${workflowName}\`
- Actions run：\`${runId}\`，attempt \`${runAttempt}\`
- 证据工件：\`${artifactName}\`
- 工作分支：\`${checkoutBranch}\`
- 验证提交：\`${checkoutSha}\`
- 原始业务源码基线：\`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62\`
- 运行环境：${environment?.runner?.os || 'Linux'} / ${environment?.runner?.architecture || 'X64'}；${commandVersion(environment, 'node')}；${commandVersion(environment, 'rustc')}；${commandVersion(environment, 'chrome')}。

## 实际执行结果

### 硬性检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
${renderCheckTable(summary.requiredChecks)}

### 扩展检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
${renderCheckTable(summary.extendedChecks)}

${passed
    ? renderPassedSection()
    : renderFailureSection({ summary, browserLog, cargoTestLog, cargoCheckLog, tauriBuildLog })}

## 冻结模型哈希

| 文件 | 行数 | SHA-256 | 冻结范围 |
|---|---:|---|---|
${renderFrozenModels(frozenModels)}

## 契约与源码采集

- 跟踪文件：${sourceManifest.length} 个。
- 冻结模型：${frozenModels.length} 个。
- Tauri command 注解：${annotatedCommands.length} 个。
- \`generate_handler!\` 注册项：${handlerEntries.length} 个。
- storage key：${storageKeys.length} 个。
- 被跟踪的运行或生成产物：${trackedOutputs.length} 个。

${trackedOutputs.map(path => `- \`${path}\``).join('\n') || '- 未发现被跟踪的运行或生成产物。'}

## 大型生产文件信号

${largestSources.map(record => `- \`${record.path}\`：${record.lines} 行，${record.bytes} bytes。`).join('\n')}

行数仅作为风险信号；后续拆分仍以职责、状态所有权和依赖方向为准。
`;
}
