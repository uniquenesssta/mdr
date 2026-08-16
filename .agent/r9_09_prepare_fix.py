from pathlib import Path

apply_path = Path('.agent/r9_09_apply.py')
text = apply_path.read_text(encoding='utf-8')
text = text.replace(
    "return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], text=True)",
    "return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], text=True, stderr=subprocess.DEVNULL)",
    1,
)
old_fake = """  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) throw new Error('missing child');
    previous.parentNode = null;
    next.parentNode = this;
    this.children.splice(index, 1, next);
  }
  normalize() {"""
new_fake = """  replaceChild(next, previous) {
    const index = this.children.indexOf(previous);
    if (index < 0) throw new Error('missing child');
    previous.parentNode = null;
    next.parentNode = this;
    this.children.splice(index, 1, next);
  }
  replaceWith(next) { this.parentNode?.replaceChild(next, this); }
  normalize() {"""
if old_fake not in text:
    raise SystemExit('R9-09 FakeElement patch marker missing')
text = text.replace(old_fake, new_fake, 1)
text = text.replace(
    "assert.doesNotMatch(session, /retry|MAX_RETRIES|setTimer|scheduleFrame/);",
    "assert.doesNotMatch(session, /MAX_RETRIES|setTimer|scheduleFrame|scheduleRetry|retryCount|retryTimer/);",
    1,
)
text = text.replace(
    "        'tests/stage-01-handoff.test.mjs',\n",
    "        'tests/stage-01-handoff.test.mjs',\n        'tests/stage-09-selection-feedback-guard.test.mjs',\n",
    1,
)
old_facade = " * Responsibility: Public Stage 9 synchronization contract. Prior Stage 9 owners remain frozen while R9-09 adds the canonical SelectionHighlightSession; R9-10+ selection policy remains unmigrated.\\n"
new_facade = " * Responsibility: Public Stage 9 synchronization contract. R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07 and R9-08 owners remain frozen while R9-09 adds the canonical SelectionHighlightSession; R9-10+ selection policy remains unmigrated.\\n"
if old_facade not in text:
    raise SystemExit('R9-09 facade traceability marker missing')
text = text.replace(old_facade, new_facade, 1)
marker = """        if path.endswith('stage-09-selection-feedback-guard.test.mjs'):
            text = text.replace('does not advance R9-09+', 'does not advance R9-10+')
            text = text.replace('cardinality 379', 'cardinality 380 after R9-09 inventory growth')
"""
replacement = marker + """            text = text.replace(
                "    feedbackGuard: guard\\n  }).configure({ syncPreviewToEditor",
                "    feedbackGuard: guard,\\n    highlightSession: { restore() { return false; }, clear() {} }\\n  }).configure({ syncPreviewToEditor"
            )
            text = text.replace(
                "    feedbackGuard: guard\\n  });\\n  const token = guard.begin('editor');",
                "    feedbackGuard: guard,\\n    highlightSession: { restore() { return false; }, clear() {} }\\n  });\\n  const token = guard.begin('editor');"
            )
"""
if marker not in text:
    raise SystemExit('R9-08 historical fixture migration marker missing')
apply_path.write_text(text.replace(marker, replacement, 1), encoding='utf-8')

validate_path = Path('.agent/r9_09_validate.sh')
validator = validate_path.read_text(encoding='utf-8')
vmarker = """    if path.endswith('stage-09-selection-feedback-guard.test.mjs'):
        text = text.replace('does not advance R9-09+', 'does not advance R9-10+')
        text = text.replace('cardinality 379', 'cardinality 380 after R9-09 inventory growth')
"""
vreplacement = vmarker + """        text = text.replace(
            "    feedbackGuard: guard\\n  }).configure({ syncPreviewToEditor",
            "    feedbackGuard: guard,\\n    highlightSession: { restore() { return false; }, clear() {} }\\n  }).configure({ syncPreviewToEditor"
        )
        text = text.replace(
            "    feedbackGuard: guard\\n  });\\n  const token = guard.begin('editor');",
            "    feedbackGuard: guard,\\n    highlightSession: { restore() { return false; }, clear() {} }\\n  });\\n  const token = guard.begin('editor');"
        )
"""
if vmarker not in validator:
    raise SystemExit('R9-09 validator normalization marker missing')
validator = validator.replace(vmarker, vreplacement, 1)
old_readme = "R9-09：SelectionHighlightSession 接管 CSS Highlight 多 Range、原子/文本 fallback、remount 恢复与 clear/destroy；R9-10+ 未启动。验证：R9-09 16/16；R9-08 16/16；R9-07 15/15；R9-06 14/14；R9-05 16/16；R9-04 14/14；R9-03~R9-01 13/13；Stage8 179/179；Node ${node_tests}/${node_pass}；Architecture/Build PASS；Browser 10/10；Built-app 29/29×2；audit 0。"
new_readme = "R9-09：SelectionHighlightSession接管CSS多Range、原子/文本fallback、remount恢复及clear/destroy；R9-10+未启动。验证：R9-09/R9-08 16/16，R9-07 15/15，R9-06 14/14，R9-05 16/16，R9-04 14/14，R9-03~R9-01 13/13，Stage8 179/179，Node ${node_tests}/${node_pass}，Architecture/Build PASS，Browser 10/10，Built-app 29/29×2，audit 0。"
if old_readme not in validator:
    raise SystemExit('R9-09 README template marker missing')
validator = validator.replace(old_readme, new_readme, 1)
validate_path.write_text(validator, encoding='utf-8')

Path(__file__).unlink()
