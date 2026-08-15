from pathlib import Path
import re


def replace_once(path: str, pattern: str, replacement: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1)
    if count != 1:
        raise SystemExit(f'{path}: expected one transport-alignment match, found {count}')
    target.write_text(updated, encoding='utf-8')


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
    r"assert.doesNotMatch(controller, /import\\s*\\{[^}]*MermaidBlockWidget[^}]*\\}\\s*from '\\.\\/widgets\\.js'/);",
)

print('Atomic 8.12 transport alignment applied')
