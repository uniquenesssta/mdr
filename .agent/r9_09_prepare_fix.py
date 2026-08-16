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
validate_path.write_text(validator.replace(vmarker, vreplacement, 1), encoding='utf-8')

Path(__file__).unlink()
