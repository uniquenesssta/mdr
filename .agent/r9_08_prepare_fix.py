from pathlib import Path

path = Path('.agent/r9_08_apply.py')
text = path.read_text(encoding='utf-8')

old_comment = "    ' * Responsibility: Public Stage 9 synchronization contract. R9-04 through R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.\\n * Imports: Public synchronization modules only.\\n * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.\\n'"
new_comment = "    ' * Responsibility: Public Stage 9 synchronization contract. R9-04, R9-05, R9-06 and R9-07 remain frozen while R9-08 adds the canonical SelectionFeedbackGuard; later selection policy remains unmigrated.\\n * Imports: Public synchronization modules only.\\n * Exports: Scroll owners/mappers/geometry, Selection Readers and the R9-08 Feedback Guard classes/factories.\\n'"
if text.count(old_comment) != 1:
    raise RuntimeError(f'expected one Sync facade R9 history marker, found {text.count(old_comment)}')
text = text.replace(old_comment, new_comment, 1)

old_gate = "    replace_all_existing(str(path), \"  'src/features/sync/selection/selection-feedback-guard.js',\\n\", '')"
new_gate = "    replace_all_existing(str(path), \"  'src/features/sync/selection/selection-feedback-guard.js',\\n\", '')\n    replace_all_existing(str(path), \"  'src/features/sync/selection/selection-feedback-guard.js'\\n\", '')"
if text.count(old_gate) != 1:
    raise RuntimeError(f'expected one historical later-file migration marker, found {text.count(old_gate)}')
text = text.replace(old_gate, new_gate, 1)

path.write_text(text, encoding='utf-8')
Path(__file__).unlink()
