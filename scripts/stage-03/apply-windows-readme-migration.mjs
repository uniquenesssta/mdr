import { readFile, writeFile } from 'node:fs/promises';

const checksPath = 'scripts/architecture/checks.mjs';
const docsReadmePath = 'docs/README.md';
const rootReadmePath = 'README.md';
const marker = '<!-- stage-03-windows-automation:03-05 -->';
const entry = `${marker}
- 2026-08-06：阶段 3 Atomic Task 3.5 的 Windows Automated 补充实现完成：新增独立 Windows 2025 门禁，以固定版本 WebdriverIO 和 tauri-driver 驱动真实 WebView2，覆盖最大化/还原、最小化/恢复、resize 订阅与幂等 disposer、标题栏真实拖动、close-request 阻止及保存边界、正常关闭和强制关闭。测试工具仅在 CI 中临时安装，未修改生产依赖、锁文件、Rust、权限或 Tauri 全局 API 配置。原根 README 已完整迁移到 \`docs/README.md\`，根 README 改为简短项目介绍；架构记录和 Stage 0 持久化入口同步迁移。Windows 实际运行结果将在门禁完成后替换本记录。
`;

async function patchArchitectureReadmePath() {
  const source = await readFile(checksPath, 'utf8');
  const from = "const readmePath = 'README.md';";
  const to = "const readmePath = 'docs/README.md';";
  const matches = source.split(from).length - 1;

  if (matches === 1) {
    await writeFile(checksPath, source.replace(from, to), 'utf8');
    return;
  }
  if (source.includes(to)) return;
  throw new Error(`Expected exactly one architecture README path, found ${matches}.`);
}

function upsertEntry(readme) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = new RegExp(`${escapedMarker}\\n- [^\\n]*\\n?`, 'g');
  if (existing.test(readme)) return readme.replace(existing, entry);

  const heading = '## Change Log';
  const headingIndex = readme.indexOf(heading);
  if (headingIndex < 0) throw new Error('docs/README.md is missing ## Change Log.');
  const lineEnd = readme.indexOf('\n', headingIndex + heading.length);
  const insertAt = lineEnd >= 0 ? lineEnd + 1 : readme.length;
  return `${readme.slice(0, insertAt)}${entry}${readme.slice(insertAt)}`;
}

async function patchDocumentation() {
  const [rootReadme, docsReadme] = await Promise.all([
    readFile(rootReadmePath, 'utf8'),
    readFile(docsReadmePath, 'utf8')
  ]);

  if (!rootReadme.includes('[docs/README.md](docs/README.md)')) {
    throw new Error('Root README does not link to docs/README.md.');
  }
  if (!docsReadme.includes('<!-- stage-03-node:03-05 -->')) {
    throw new Error('Detailed README migration is incomplete.');
  }

  await writeFile(docsReadmePath, upsertEntry(docsReadme), 'utf8');
}

await patchArchitectureReadmePath();
await patchDocumentation();
