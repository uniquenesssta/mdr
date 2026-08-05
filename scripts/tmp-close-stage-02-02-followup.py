from pathlib import Path

browser_path = Path('tests/e2e/run-browser-tests.mjs')
browser = browser_path.read_text(encoding='utf-8')
manual_i18n = r'''      await browser.page.evaluate(`new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='${virtualHost.origin}/i18n.js';script.onload=resolve;script.onerror=()=>reject(new Error('i18n failed'));document.body.appendChild(script);})`);
'''
if manual_i18n not in browser:
    raise SystemExit('manual browser i18n loader not found')
browser_path.write_text(browser.replace(manual_i18n, '', 1), encoding='utf-8')

readme_path = Path('README.md')
readme = readme_path.read_text(encoding='utf-8')
old_entry = '- 2026-08-05：阶段 2 Atomic Task 2.2（最小 index.html）已实施并进入最终收口复验：入口缩减为 head、#app-root 与单一模块入口，旧 DOM 移至唯一阶段兼容资产并通过独立挂载模块运行；修复构建后浏览器测试对独立 stylesheet 标签的过时强制假设，继续硬性要求模块入口并真实执行完整应用回归；Atomic Task 2.3 尚未开始。'
new_entry = '- 2026-08-05：阶段 2 Atomic Task 2.2（最小 index.html）已实施并进入最终收口复验：入口缩减为 head、#app-root 与单一模块入口，旧 DOM 移至唯一阶段兼容资产并通过独立挂载模块运行；构建后浏览器测试继续硬性要求模块入口，允许 CSS 由模块图加载，并由模块入口唯一加载 i18n 后真实执行完整应用回归；Atomic Task 2.3 尚未开始。'
if old_entry not in readme:
    raise SystemExit('intermediate README 2.2 entry not found')
readme_path.write_text(readme.replace(old_entry, new_entry, 1), encoding='utf-8')

record_path = Path('docs/rewrite-progress/stage-02/02-02-minimal-index.md')
record = record_path.read_text(encoding='utf-8')
root_cause_anchor = '模块脚本、Node 测试、浏览器契约、构建、Rust 和 Tauri 链路本身均未失败。\n'
root_cause_addition = root_cause_anchor + '\n首次收口验证 run `30999898039` 修复资产发现后，完整应用已启动并通过 7 项交互，随后捕获 `Identifier \'i18n\' has already been declared`。原因是旧浏览器测试仍手动注入 `i18n.js`，而 2.2 模块入口已承担同一加载职责，形成测试侧与生产入口的双重所有权。该失败同样发生在提交前，未推送正式修复。\n'
if root_cause_anchor not in record:
    raise SystemExit('record root-cause anchor not found')
record = record.replace(root_cause_anchor, root_cause_addition, 1)
fix_anchor = '- 独立 stylesheet 标签改为可选：存在时仍单独加载，不存在时由真实模块图加载 CSS。\n'
fix_addition = fix_anchor + '- 删除浏览器测试对 `i18n.js` 的手动注入，由 `src/bootstrap/module-entry.js` 保持唯一加载所有权。\n'
if fix_anchor not in record:
    raise SystemExit('record fix anchor not found')
record_path.write_text(record.replace(fix_anchor, fix_addition, 1), encoding='utf-8')
