from pathlib import Path

part = Path('.agent/r9_10_apply.part2')
text = part.read_text(encoding='utf-8')
old = "if legacy.count('            maxRetries: 3,\\n') != 1 or legacy.count('        maxRetries: 3,\\n') != 1:"
new = "if legacy.count('maxRetries: 3,\\n') != 2:"
if old not in text:
    raise SystemExit('R9-10 legacy retry-limit locator marker missing')
text = text.replace(old, new, 1)
old_facade = "R9-01 through R9-09 owners remain frozen while R9-10 adds the canonical SelectionRetryScheduler"
new_facade = "R9-01, R9-02, R9-03, R9-04, R9-05, R9-06, R9-07, R9-08 and R9-09 owners remain frozen while R9-10 adds the canonical SelectionRetryScheduler"
if old_facade not in text:
    raise SystemExit('R9-10 facade traceability marker missing')
text = text.replace(old_facade, new_facade, 1)
part.write_text(text, encoding='utf-8')
Path(__file__).unlink()
