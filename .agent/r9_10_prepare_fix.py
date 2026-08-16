from pathlib import Path

part = Path('.agent/r9_10_apply.part2')
text = part.read_text(encoding='utf-8')
old = "if legacy.count('            maxRetries: 3,\\n') != 1 or legacy.count('        maxRetries: 3,\\n') != 1:"
new = "if legacy.count('maxRetries: 3,\\n') != 2:"
if old not in text:
    raise SystemExit('R9-10 legacy retry-limit locator marker missing')
part.write_text(text.replace(old, new, 1), encoding='utf-8')
Path(__file__).unlink()
