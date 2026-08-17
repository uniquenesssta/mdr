from pathlib import Path

TOKEN = 'markdownEditorEditorScrollMapper'
MAIN_PATH = Path('src/main.js')
README_PATH = Path('README.md')


def read(path):
    return path.read_text(encoding='utf-8')


def write(path, text):
    path.write_text(text, encoding='utf-8')


unexpected = []
for root_name in ('src', 'public'):
    root = Path(root_name)
    for path in root.rglob('*'):
        if not path.is_file() or path == MAIN_PATH or path.suffix not in {'.js', '.mjs', '.html'}:
            continue
        try:
            source = read(path)
        except UnicodeDecodeError:
            continue
        if TOKEN in source:
            unexpected.append(str(path))
if unexpected:
    raise SystemExit('R9-04 compatibility mapper still has production consumers: ' + ', '.join(unexpected))

main = read(MAIN_PATH)
assignment = "    if (compatibilityPlatformHost) compatibilityPlatformHost.markdownEditorEditorScrollMapper = editorScrollMapper;\n"
old_cleanup = """  const destroyEditorScrollMapper = () => {
    if (compatibilityPlatformHost?.markdownEditorEditorScrollMapper === editorScrollMapper) {
      delete compatibilityPlatformHost.markdownEditorEditorScrollMapper;
    }
    editorScrollMapper?.destroy();
    editorScrollMapper = null;
  };
"""
new_cleanup = """  const destroyEditorScrollMapper = () => {
    editorScrollMapper?.destroy();
    editorScrollMapper = null;
  };
"""

if TOKEN in main:
    if main.count(TOKEN) != 3:
        raise SystemExit(f'{MAIN_PATH}: expected exactly three R9-04 compatibility token occurrences, found {main.count(TOKEN)}')
    if main.count(assignment) != 1:
        raise SystemExit(f'{MAIN_PATH}: expected exactly one EditorScrollMapper compatibility assignment')
    if main.count(old_cleanup) != 1:
        raise SystemExit(f'{MAIN_PATH}: expected exactly one EditorScrollMapper compatibility cleanup block')
    main = main.replace(assignment, '', 1).replace(old_cleanup, new_cleanup, 1)
    if TOKEN in main:
        raise SystemExit(f'{MAIN_PATH}: compatibility token survived cleanup')
    write(MAIN_PATH, main)
elif new_cleanup not in main:
    raise SystemExit(f'{MAIN_PATH}: EditorScrollMapper cleanup shape is unexpected')

readme = read(README_PATH)
entry = (
    'R9-04 production cleanup：全生产树扫描确认 `markdownEditorEditorScrollMapper` 除 `src/main.js` 外无任何消费者；'
    '本补丁删除 EditorScrollMapper 向 `compatibilityPlatformHost` 的遗留暴露及对应 delete 清理，'
    '保留通过 Sync public factory 创建、显式注入 Selection/Scroll 链和 `EditorScrollMapper.destroy()` 生命周期不变。'
    '该修改不改 CodeMirror 几何读取、frozen model line-range、滚动算法或用户可观察行为；R9-04/R9-05/R9-12 targeted 与 build 由 candidate CI 在提交前验证。'
)
if entry not in readme:
    write(README_PATH, readme.rstrip() + '\n\n' + entry + '\n')
