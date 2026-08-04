import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const reportRoot = resolve(process.env.STAGE0_REPORT_DIR || 'artifacts/stage-00');
const stageDirectory = resolve(root, 'docs/rewrite-progress/stage-00');
const evidenceDirectory = resolve(stageDirectory, 'evidence');
await mkdir(evidenceDirectory, { recursive: true });

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptional(path, fallback = '') {
  try {
    return await readFile(path, 'utf8');
  } catch (_) {
    return fallback;
  }
}

function stripAnsi(value) {
  return String(value || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function tailLines(value, count = 60) {
  return stripAnsi(value).replace(/\r\n/g, '\n').split('\n').slice(-count).join('\n').trim();
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

const summary = await readJson(resolve(reportRoot, 'summary/verification-summary.json'));
const baselineEnvironment = await readJson(resolve(reportRoot, 'baseline/environment.json'));
const frozenModels = await readJson(resolve(reportRoot, 'baseline/contracts/frozen-model-hashes.json'));
const tauriCommands = await readJson(resolve(reportRoot, 'baseline/contracts/tauri-commands.json'));
const storageKeys = await readJson(resolve(reportRoot, 'baseline/contracts/storage-keys.json'));
const sourceManifest = await readJson(resolve(reportRoot, 'baseline/source-manifest.json'));
const baselineSummary = await readOptional(resolve(reportRoot, 'baseline/baseline-summary.md'));
const trackedRuntimeOutput = await readOptional(resolve(reportRoot, 'baseline/tracked-runtime-output.txt'));
const browserLog = await readOptional(resolve(reportRoot, 'checks/browser-app.log'));
const cargoTestLog = await readOptional(resolve(reportRoot, 'checks/cargo-test.log'));
const cargoCheckLog = await readOptional(resolve(reportRoot, 'checks/cargo-check.log'));
const tauriBuildLog = await readOptional(resolve(reportRoot, 'checks/tauri-build.log'));

const checkoutSha = runGit(['rev-parse', 'HEAD']);
const checkoutBranch = runGit(['branch', '--show-current']);
const runId = process.env.GITHUB_RUN_ID || 'unknown';
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || 'unknown';
const workflowName = process.env.GITHUB_WORKFLOW || 'Stage 0 Baseline Verification';
const artifactName = `stage-00-baseline-${runId}-${runAttempt}`;
const date = new Date().toISOString().slice(0, 10);

const browserFailures = stripAnsi(browserLog)
  .split('\n')
  .filter(line => line.includes('not ok - '))
  .map(line => line.slice(line.indexOf('not ok - ') + 'not ok - '.length).trim());

const requiredRows = summary.requiredChecks.map(record => (
  `| \`${record.id}\` | ${record.status} | ${record.exitCode ?? '-'} | ${record.durationMs ?? '-'} |`
));
const extendedRows = summary.extendedChecks.map(record => (
  `| \`${record.id}\` | ${record.status} | ${record.exitCode ?? '-'} | ${record.durationMs ?? '-'} |`
));

const frozenRows = frozenModels.map(record => (
  `| \`${record.path}\` | ${record.lines ?? '-'} | \`${record.sha256 || 'missing'}\` | ${record.scope} |`
));

const annotatedCommandNames = tauriCommands.annotated.map(record => record.name).sort();
const handlerEntries = tauriCommands.invokeHandlerEntries || [];
const trackedOutputs = trackedRuntimeOutput.split(/\r?\n/).filter(Boolean);
const largeSources = sourceManifest
  .filter(record => Number.isFinite(record.lines) && !record.path.startsWith('docs/'))
  .sort((left, right) => right.lines - left.lines)
  .slice(0, 15);

const rustFailureExcerpt = tailLines(cargoTestLog || cargoCheckLog, 35);
const tauriFailureExcerpt = tailLines(tauriBuildLog, 35);
const browserFailureExcerpt = tailLines(browserLog, 80);

const record = `# 阶段 0 / 节点 00-02：GitHub Actions 基线验证结果

## 节点状态

- 结果：**失败，阶段 0 硬性门禁未通过**
- 后续阶段：**禁止进入阶段 1**
- 工作流：\`${workflowName}\`
- Actions run：\`${runId}\`，attempt \`${runAttempt}\`
- 证据工件：\`${artifactName}\`
- 工作分支：\`${checkoutBranch || process.env.GITHUB_HEAD_REF || 'rewrite/modular-rebuild'}\`
- 验证提交：\`${checkoutSha}\`
- 原始业务源码基线：\`main@8ec8bf4ed58e6fd1c5c91466569a56ba247b6a62\`
- 运行环境：GitHub-hosted \`ubuntu-22.04\`、Node 22、Rust 1.77.2、Chrome headless

## 实际执行结果

### 硬性检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
${requiredRows.join('\n')}

### 扩展检查

| 检查 | 状态 | 退出码 | 耗时 ms |
|---|---:|---:|---:|
${extendedRows.join('\n')}

## 已通过路径

- 仓库 checkout 与完整 Git 历史读取成功。
- Rust 1.77.2 toolchain 安装成功。
- Tauri Linux 系统依赖安装成功。
- Chrome/Chromium 解析成功。
- 静态基线、源码清单和契约采集成功。
- \`npm ci\` 成功。
- Node 测试套件成功。
- 浏览器交互契约成功。
- Vite 生产构建成功。

## 硬性失败 1：应用级浏览器回归

\`npm run test:browser\` 共执行 7 项，2 项通过、5 项失败：

${browserFailures.map(item => `- ${item}`).join('\n') || '- 未能解析失败项目名称，见日志摘录。'}

这些失败发生在当前未修改的业务实现上。阶段 0 不修改实现，因此本节点仅冻结现象并阻止进入后续重写阶段。

<details>
<summary>浏览器失败日志摘录</summary>

\`\`\`text
${browserFailureExcerpt}
\`\`\`

</details>

## 硬性失败 2：Rust 声明版本与锁定依赖不兼容

\`src-tauri/Cargo.toml\` 声明：

- edition：2021
- rust-version：1.77.2

但 \`Cargo.lock\` 解析到的 \`dlopen2_derive v0.4.2\` 需要 Cargo 的 Edition 2024 支持。Cargo 1.77.2 无法解析该依赖清单，导致：

- \`cargo +1.77.2 test --locked\`：退出码 101；
- \`cargo +1.77.2 check --locked\`：退出码 101；
- Tauri Linux build：在 Rust 编译阶段失败。

这不是 runner 缺少 WebKitGTK 或编译工具造成的失败；相关系统依赖已经安装成功。当前仓库的声明 MSRV、锁文件和实际依赖链不一致。

<details>
<summary>Rust 失败日志摘录</summary>

\`\`\`text
${rustFailureExcerpt}
\`\`\`

</details>

<details>
<summary>Tauri build 失败日志摘录</summary>

\`\`\`text
${tauriFailureExcerpt}
\`\`\`

</details>

## 冻结模型哈希

| 文件 | 行数 | SHA-256 | 冻结范围 |
|---|---:|---|---|
${frozenRows.join('\n')}

## 契约采集结果

- 跟踪文件：${sourceManifest.length} 个。
- 冻结模型：${frozenModels.length} 个。
- Tauri command 注解：${annotatedCommandNames.length} 个。
- \`generate_handler!\` 注册项：${handlerEntries.length} 个。
- storage key：${storageKeys.length} 个。
- 当前注解命令：${annotatedCommandNames.map(name => `\`${name}\``).join('、')}。

注：首轮采集器的单条 \`registered\` 布尔值只按裸函数名匹配，而注册项包含模块前缀；应以本记录中的“注解数量 19 / handler 注册数量 19”和原始列表为准，不将该布尔字段作为契约缺失结论。

## 当前被跟踪的运行或生成产物

${trackedOutputs.map(path => `- \`${path}\``).join('\n') || '- 未发现。'}

上述文件在阶段 0 仅记录，不擅自删除；清理必须按任务书进入对应 Atomic Task 并验证。

## 当前大型生产文件信号

${largeSources.map(record => `- \`${record.path}\`：${record.lines} 行，${record.bytes} bytes。`).join('\n')}

行数只作为风险信号；后续拆分仍以职责、状态所有权和依赖边界为依据。

## 修改范围

本节点未修改业务源码、模型算法、公共接口、持久化格式或用户行为。新增内容仅包括：

- GitHub Actions 阶段 0 工作流；
- 基线与契约采集脚本；
- 命令执行记录器；
- 本阶段验证记录与证据文件。

## 尚未排除的风险

- 应用级浏览器失败是否同时存在于 Windows Chrome/Edge，需要后续在 Windows runner 或真实桌面环境复核。
- Rust 依赖链需要在独立决策中选择：提高并准确声明 MSRV，或回退/约束依赖以继续支持 Rust 1.77.2。阶段 0 不擅自选择。
- Tauri Linux 打包尚未通过，原因受 Rust 版本冲突阻断。
- 工作流只验证 Linux runner；Windows 原生窗口、文件关联和桌面拖放仍未验证。

## 阶段结论

阶段 0 已成功建立可复现验证环境并捕获当前真实基线，但退出条件尚未满足。必须先处理或明确接受以下基线阻塞：

1. 5 项应用级浏览器回归失败；
2. Rust 1.77.2 与锁定依赖 Edition 2024 不兼容；
3. Rust/Tauri 构建链因此无法通过。

在这些硬性问题解决并重新验证前，不进入阶段 1。
`;

await writeFile(resolve(stageDirectory, '00-02-baseline-verification-run.md'), record, 'utf8');

const evidenceCopies = [
  ['summary/verification-summary.json', 'verification-summary.json'],
  ['baseline/contracts/frozen-model-hashes.json', 'frozen-model-hashes.json'],
  ['baseline/contracts/tauri-commands.json', 'tauri-commands.json'],
  ['baseline/contracts/storage-keys.json', 'storage-keys.json'],
  ['baseline/baseline-summary.md', 'baseline-summary.md'],
  ['baseline/tracked-runtime-output.txt', 'tracked-runtime-output.txt']
];
for (const [source, target] of evidenceCopies) {
  await copyFile(resolve(reportRoot, source), resolve(evidenceDirectory, target));
}

const readmePath = resolve(root, 'README.md');
let readme = await readFile(readmePath, 'utf8');
const marker = `<!-- stage-00-run:${runId}:${runAttempt} -->`;
if (!readme.includes(marker)) {
  const entry = `${marker}\n- ${date}：阶段 0 GitHub Actions 基线验证已建立并运行（run ${runId}）；依赖安装、Node 测试、浏览器契约与前端构建通过，应用级浏览器回归 5 项失败，Rust/Tauri 因声明的 Rust 1.77.2 无法解析 Edition 2024 依赖而失败。阶段 0 门禁保持失败，未进入阶段 1。\n`;
  const heading = '## Change Log';
  const headingIndex = readme.indexOf(heading);
  if (headingIndex >= 0) {
    const insertAt = readme.indexOf('\n', headingIndex + heading.length) + 1;
    readme = `${readme.slice(0, insertAt)}${entry}${readme.slice(insertAt)}`;
  } else {
    readme = `${readme.trimEnd()}\n\n## Change Log\n${entry}`;
  }
  await writeFile(readmePath, readme, 'utf8');
}

console.log(`Persisted Stage 0 run ${runId} evidence and README record.`);
