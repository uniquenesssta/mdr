from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


main_path = 'src/main.js'
main = read(main_path)
old_cleanup = """  const destroyPreviewScrollMapper = () => {
    if (compatibilityPlatformHost?.markdownEditorPreviewScrollMapper === previewScrollMapper) {
      delete compatibilityPlatformHost.markdownEditorPreviewScrollMapper;
    }
    previewScrollMapper?.destroy();
    previewScrollMapper = null;
  };
"""
new_cleanup = """  const destroyPreviewScrollMapper = () => {
    previewScrollMapper?.destroy();
    previewScrollMapper = null;
  };
"""

if old_cleanup in main:
    if main.count(old_cleanup) != 1:
        raise SystemExit(f'{main_path}: expected exactly one stale PreviewScrollMapper cleanup')
    main = main.replace(old_cleanup, new_cleanup, 1)
    write(main_path, main)
elif new_cleanup not in main:
    raise SystemExit(f'{main_path}: PreviewScrollMapper cleanup shape is unexpected')

readme_path = 'README.md'
readme = read(readme_path)
entry = (
    'R9-05 production cleanup：R9-12 已在创建路径移除 `compatibilityPlatformHost.markdownEditorPreviewScrollMapper` 暴露，'
    '但 teardown 仍残留对应的不可达 delete 分支；本补丁仅删除该死兼容清理，保留 `PreviewScrollMapper.destroy()` 与 teardown 顺序不变。'
    '该修复不改 Preview 映射算法、虚拟高度能力、滚动策略或用户可观察行为；targeted R9-12 与 build 由 candidate CI 在提交前执行。'
)
if entry not in readme:
    readme = readme.rstrip() + '\n\n' + entry + '\n'
    write(readme_path, readme)
