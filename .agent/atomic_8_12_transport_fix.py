from pathlib import Path
import re


def replace_once(path: str, pattern: str, replacement: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'{path}: expected one transport-alignment match, found {count}')
    target.write_text(updated, encoding='utf-8')


def replace_literal_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one literal contract match, found {count}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


# The runner helper is transferred as base64 text. Restore the exact preserved
# Mermaid fallback message at the integration boundary before validation.
replace_once(
    'src/editor/hybrid/controller.js',
    r"message: error\?\.message \|\| String\(error \|\| 'Mermaid 图表[^']*'\)",
    "message: error?.message || String(error || 'Mermaid 图表渲染失败')",
)

# Scope the ownership assertion to the legacy import statement itself. A broad
# cross-file regex can falsely span from the composed factory to a later import.
replace_once(
    'tests/architecture/stage-08-hybrid-mermaid.test.mjs',
    r"assert\.doesNotMatch\(controller, /MermaidBlockWidget\[\\s\\S\]\*from '\\\.\\/widgets\\\.js'/\);",
    r"assert.doesNotMatch(controller, /import\s*\{[^}]*MermaidBlockWidget[^}]*\}\s*from '\.\/widgets\.js'/);",
)

# Earlier Atomic ownership contracts previously used the future Mermaid files as
# an absence guard. After 8.12 those files are authoritative, so preserve the
# older component ownership checks while advancing only the stage-boundary fact.
old_mermaid_absence = """  for (const mermaidPath of [
    'src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-render-state.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js'
  ]) {
    assert.equal(paths.has(mermaidPath), false, mermaidPath);
    await assert.rejects(access(file(mermaidPath)), undefined, mermaidPath);
  }
"""
new_mermaid_presence = """  for (const mermaidPath of [
    'src/features/hybrid-editor/widgets/mermaid/mermaid-widget.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-render-state.js',
    'src/features/hybrid-editor/widgets/mermaid/mermaid-actions.js'
  ]) {
    assert.equal(paths.has(mermaidPath), true, mermaidPath);
    await access(file(mermaidPath));
  }
"""
for contract_path in [
    'tests/architecture/stage-08-hybrid-image.test.mjs',
    'tests/architecture/stage-08-hybrid-table.test.mjs',
]:
    replace_literal_once(contract_path, old_mermaid_absence, new_mermaid_presence)
    target = Path(contract_path)
    target.write_text(
        target.read_text(encoding='utf-8').replace(
            'after Atomic 8.11 Math migration',
            'after Atomic 8.12 Mermaid migration',
            1,
        ),
        encoding='utf-8',
    )

print('Atomic 8.12 transport alignment applied')
