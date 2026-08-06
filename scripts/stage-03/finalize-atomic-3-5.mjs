import { mkdir, readFile, writeFile } from 'node:fs/promises';

const README_PATH = 'README.md';
const PROGRESS_PATH = 'docs/rewrite-progress/stage-03/03-05-window-client.md';
const NEW_MARKER = '<!-- stage-03-node:03-05 -->';
const PREVIOUS_MARKER = '<!-- stage-03-node:03-04 -->';

const readmeEntry = `${NEW_MARKER}
- 2026-08-06：阶段 3 Atomic Task 3.5（Window client）完成：新增 \`src/platform/desktop/window-client.js\`，由该模块唯一持有 \`@tauri-apps/api/window\` 导入，统一窗口拖动、最小化、最大化切换、最大化状态读取、resize 与 close-request 订阅、正常关闭和强制关闭。Window client 独占原生订阅 disposer，返回幂等 disposer，\`destroy()\` 按逆序清理且自身幂等；销毁后才完成的订阅会立即释放，不进入活动集合，原生调用与清理异常保持原始语义。\`src/runtime/tauri.js\` 已移除 \`getCurrentWindow\` 直连并通过公共平台入口委托八个窗口方法，桌面不可用时的 \`null\`、\`false\` 和空返回保持不变。关闭前保存、\`preventDefault()\`、最终快照等待与失败时强制关闭策略继续由 \`public/app/events.js\` 拥有，未下沉到平台层。生产模块清单由 159 增至 160，平台模块由 20 增至 21。实现提交 \`227a1d86f6c959ecc14874a0e2b151abff6ae113\`，受控验证提交 \`77fce3ef8041d54b5cd6a67edbea03d9facbd637\`：Stage 0 run \`31105812402\`、Stage 1 run \`31105812432\`、Stage 2 run \`31105812320\`、Stage 3 run \`31105812338\` 全部通过；Stage 3 覆盖 3.1–3.5 专项契约、架构硬门禁、完整 Node 回归、Chromium 交互契约、生产构建、构建后应用回归和机器证据生成，Stage 0 同时通过 Rust test/check 与 Tauri Linux build。证据制品 \`stage-03-platform-foundation-31105812338-1\`（artifact \`8969486354\`，\`sha256:d731c13a4a52fbdf79b774f95c6d63e431fb609b906e944647d7fbfe34fd68e9\`）已生成。未修改 Rust、DTO、持久化、冻结模型、生产依赖或锁文件；既有 \`1 low / 1 high\` 依赖审计结果未扩大。Windows 原生 WebView 的窗口拖动、最大化、resize、关闭请求与 disposer 路径尚未执行真实平台验证；DragDrop 及后续 adapter 仍由后续 Atomic Task 实施。
`;

const progress = `# Stage 3 / Atomic Task 3.5 — Window client

## Result

Atomic Task 3.5 is complete. Desktop application-window behavior now has one responsibility-focused owner under \`src/platform/desktop/\`, while save-before-close policy remains in the application layer.

## Implemented scope

- Added \`src/platform/desktop/window-client.js\` as the sole production owner of \`@tauri-apps/api/window\`.
- Added the frozen \`createWindowClient()\` factory through \`src/platform/index.js\`.
- Unified start-drag, minimize, toggle-maximize, maximized-state, resize subscription, close-request subscription, normal close and force close.
- Preserved native result and error semantics.
- Added owned, idempotent subscription disposers and idempotent reverse-order client cleanup.
- Disposed subscription results that resolve after client destruction instead of publishing them as active resources.
- Removed direct \`getCurrentWindow()\` use from \`src/runtime/tauri.js\` and delegated all eight compatibility methods through the public platform entry.

## Compatibility

The temporary \`window.markdownEditorNative\` methods \`onCloseRequested\`, \`startWindowDragging\`, \`minimizeWindow\`, \`toggleMaximizeWindow\`, \`isWindowMaximized\`, \`onWindowResized\`, \`closeWindow\` and \`destroyWindow\` retain their signatures, return values and unavailable fallbacks. \`public/app/events.js\` still owns close prevention, final document persistence, snapshot waiting and fallback force-close. The platform adapter does not contain document, save or confirmation policy.

No Rust command, DTO, persistence format, frozen model contract, production dependency, lock file or user-visible business behavior changed.

## Verification

Implementation commit: \`227a1d86f6c959ecc14874a0e2b151abff6ae113\`. Validation commit: \`77fce3ef8041d54b5cd6a67edbea03d9facbd637\`.

- Stage 0 Baseline Verification: run \`31105812402\`, passed, including Node, browser, build, Rust test/check and Tauri Linux build.
- Stage 1 Atomic Verification: run \`31105812432\`, passed.
- Stage 2 Atomic Verification: run \`31105812320\`, passed.
- Stage 3 Atomic Verification: run \`31105812338\`, passed, including the new 3.5 contract before architecture and full regression.
- Stage 3 evidence artifact: \`stage-03-platform-foundation-31105812338-1\`, artifact \`8969486354\`, digest \`sha256:d731c13a4a52fbdf79b774f95c6d63e431fb609b906e944647d7fbfe34fd68e9\`.
- Production inventory: 160 modules total, 21 platform modules.
- Existing dependency audit remains 1 low / 1 high; no dependency or lock-file change was made.

## Remaining risk

Ubuntu verification does not exercise Windows-native WebView window behavior. Real Windows drag, minimize/maximize, resize, close-request, normal-close, force-close and native disposer coverage remains required when desktop runtime validation is performed.

DragDrop and later concrete adapters remain assigned to subsequent Atomic Tasks.
`;

const readme = await readFile(README_PATH, 'utf8');
if (readme.includes(NEW_MARKER)) throw new Error('Atomic Task 3.5 README record already exists');
if (readme.split(PREVIOUS_MARKER).length !== 2) {
  throw new Error('Atomic Task 3.4 README marker is missing or duplicated');
}

await writeFile(README_PATH, readme.replace(PREVIOUS_MARKER, readmeEntry + PREVIOUS_MARKER), 'utf8');
await mkdir('docs/rewrite-progress/stage-03', { recursive: true });
try {
  await readFile(PROGRESS_PATH, 'utf8');
  throw new Error('Atomic Task 3.5 progress record already exists');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await writeFile(PROGRESS_PATH, progress, 'utf8');
