#!/usr/bin/env bash
set -euo pipefail

baseline='ff66d2eaa4cd030977cc3c4e57bc886e95d4110a'
validated_branch='agent/r9-08-validated'
runner_branch='agent/r9-08-runner'
workflow_path='.github/workflows/stage-07-atomic.yml'

actual="$(git ls-remote origin refs/heads/agent/r9-07-validated | awk '{print $1}')"
test "$actual" = "$baseline"
git merge-base --is-ancestor "$baseline" HEAD

python - <<'PY'
import subprocess
baseline = 'ff66d2eaa4cd030977cc3c4e57bc886e95d4110a'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
for path in changed:
    if path.startswith('.agent/r9_08_'):
        continue
    if path == '.github/workflows/stage-07-atomic.yml':
        continue
    raise SystemExit(f'Unexpected pre-validation change from R9-07 baseline: {path}')
PY

npm ci
npm audit --audit-level=high
PYTHONDONTWRITEBYTECODE=1 python .agent/r9_08_apply.py

git diff --check

test -e src/features/sync/selection/selection-feedback-guard.js
test -e tests/stage-09-selection-feedback-guard.test.mjs
test -e tests/architecture/stage-09-selection-feedback-guard.test.mjs
grep -q 'class SelectionFeedbackGuard' src/features/sync/selection/selection-feedback-guard.js
grep -q 'createSelectionFeedbackGuard' src/features/sync/index.js
grep -q 'R9-08' src/features/sync/index.js

# Exact R9-08 ownership gates.
grep -q 'this.sequence' src/features/sync/selection/selection-feedback-guard.js
grep -q 'this.source' src/features/sync/selection/selection-feedback-guard.js
grep -q 'this.revision' src/features/sync/selection/selection-feedback-guard.js
grep -q 'token.sequence !== this.sequence' src/features/sync/selection/selection-feedback-guard.js
grep -q 'incomingRevision < this.revision' src/features/sync/selection/selection-feedback-guard.js
! grep -Eq 'document\.|window\.|globalThis\.|addEventListener|removeEventListener|selectionMapping|CSS\.highlights|new Range|scrollTo|scheduleTarget|selectionSyncLock|applyingSide' src/features/sync/selection/selection-feedback-guard.js
! grep -Eq 'this\.applyingSide\s*=|this\.releaseTimer\s*=|this\.previewRevision\s*=' src/sync/selection-controller.js
! grep -q 'selectionSyncLock' public/app/core.js
! grep -q 'selectionSyncLock' public/app/scroll-sync.js
grep -q 'markdownEditorSelectionFeedbackGuard' public/app/scroll-sync.js
grep -q "selectionFeedbackGuard.shouldIgnore('editor'" public/app/scroll-sync.js
grep -q "selectionFeedbackGuard.shouldIgnore('preview'" public/app/scroll-sync.js
grep -q 'markdownEditorSelectionFeedbackGuard = selectionFeedbackGuard' src/main.js
grep -q 'feedbackGuard: selectionFeedbackGuard' src/main.js
grep -q 'selectionFeedbackGuard.destroy()' src/main.js
! grep -q 'window.markdownEditorSelectionFeedbackGuard' src/main.js

# Later Atomics must remain absent.
for path in \
  src/features/sync/selection/selection-sync-controller.js \
  src/features/sync/selection/selection-highlight-session.js \
  src/features/sync/selection/selection-retry-scheduler.js; do
  test ! -e "$path"
done

# R9-08 must not alter dependencies, frozen model/mapping, prior scroll owners, or R9-07 Readers.
test -z "$(git diff --name-only "$baseline" -- \
  package.json package-lock.json src-tauri \
  src/document/document-model.js \
  src/editor/hybrid/block-registry.js src/editor/hybrid/math-ranges.js src/editor/hybrid/ranges.js src/editor/hybrid/table-model.js \
  src/model-kernel src/features/preview \
  src/features/editor/infrastructure/codemirror-editor-adapter.js \
  src/features/sync/scroll/scroll-source-ownership.js \
  src/features/sync/scroll/scroll-sync-controller.js \
  src/features/sync/scroll/editor-scroll-mapper.js \
  src/features/sync/scroll/preview-scroll-mapper.js \
  src/features/sync/scroll/scroll-geometry-session.js \
  src/features/sync/selection/editor-selection-reader.js \
  src/features/sync/selection/preview-selection-reader.js \
  src/sync/selection-mapping.js)"

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==379) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/selection-feedback-guard.js')?.[4]!=='selection-feedback-guard-lifecycle') process.exit(2)"
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

node --test tests/stage-09-selection-feedback-guard.test.mjs | tee /tmp/r9-08-behavior.tap
grep -q '# tests 8' /tmp/r9-08-behavior.tap
grep -q '# pass 8' /tmp/r9-08-behavior.tap
grep -q '# fail 0' /tmp/r9-08-behavior.tap
node --test tests/architecture/stage-09-selection-feedback-guard.test.mjs | tee /tmp/r9-08-architecture.tap
grep -q '# tests 8' /tmp/r9-08-architecture.tap
grep -q '# pass 8' /tmp/r9-08-architecture.tap
grep -q '# fail 0' /tmp/r9-08-architecture.tap

node --test tests/stage-09-selection-readers.test.mjs | tee /tmp/r9-07-behavior.tap
grep -q '# tests 7' /tmp/r9-07-behavior.tap
grep -q '# pass 7' /tmp/r9-07-behavior.tap
grep -q '# fail 0' /tmp/r9-07-behavior.tap
node --test tests/architecture/stage-09-selection-readers.test.mjs | tee /tmp/r9-07-architecture.tap
grep -q '# tests 8' /tmp/r9-07-architecture.tap
grep -q '# pass 8' /tmp/r9-07-architecture.tap
grep -q '# fail 0' /tmp/r9-07-architecture.tap

node --test tests/stage-09-scroll-geometry-session.test.mjs | tee /tmp/r9-06-behavior.tap
grep -q '# tests 7' /tmp/r9-06-behavior.tap
grep -q '# pass 7' /tmp/r9-06-behavior.tap
grep -q '# fail 0' /tmp/r9-06-behavior.tap
node --test tests/architecture/stage-09-scroll-geometry-session.test.mjs | tee /tmp/r9-06-architecture.tap
grep -q '# tests 7' /tmp/r9-06-architecture.tap
grep -q '# pass 7' /tmp/r9-06-architecture.tap
grep -q '# fail 0' /tmp/r9-06-architecture.tap

node --test tests/stage-09-preview-scroll-mapper.test.mjs | tee /tmp/r9-05-behavior.tap
grep -q '# tests 8' /tmp/r9-05-behavior.tap
grep -q '# pass 8' /tmp/r9-05-behavior.tap
grep -q '# fail 0' /tmp/r9-05-behavior.tap
node --test tests/architecture/stage-09-preview-scroll-mapper.test.mjs | tee /tmp/r9-05-architecture.tap
grep -q '# tests 8' /tmp/r9-05-architecture.tap
grep -q '# pass 8' /tmp/r9-05-architecture.tap
grep -q '# fail 0' /tmp/r9-05-architecture.tap

node --test tests/stage-09-editor-scroll-mapper.test.mjs | tee /tmp/r9-04-behavior.tap
grep -q '# tests 7' /tmp/r9-04-behavior.tap
grep -q '# pass 7' /tmp/r9-04-behavior.tap
grep -q '# fail 0' /tmp/r9-04-behavior.tap
node --test tests/architecture/stage-09-editor-scroll-mapper.test.mjs | tee /tmp/r9-04-architecture.tap
grep -q '# tests 7' /tmp/r9-04-architecture.tap
grep -q '# pass 7' /tmp/r9-04-architecture.tap
grep -q '# fail 0' /tmp/r9-04-architecture.tap

node --test tests/stage-09-scroll-controller.test.mjs | tee /tmp/r9-03-behavior.tap
grep -q '# tests 7' /tmp/r9-03-behavior.tap
grep -q '# pass 7' /tmp/r9-03-behavior.tap
grep -q '# fail 0' /tmp/r9-03-behavior.tap
node --test tests/architecture/stage-09-scroll-controller.test.mjs | tee /tmp/r9-03-architecture.tap
grep -q '# tests 6' /tmp/r9-03-architecture.tap
grep -q '# pass 6' /tmp/r9-03-architecture.tap
grep -q '# fail 0' /tmp/r9-03-architecture.tap

node --test tests/stage-09-scroll-source-ownership.test.mjs | tee /tmp/r9-02-behavior.tap
grep -q '# tests 7' /tmp/r9-02-behavior.tap
grep -q '# pass 7' /tmp/r9-02-behavior.tap
grep -q '# fail 0' /tmp/r9-02-behavior.tap
node --test tests/architecture/stage-09-scroll-source-ownership.test.mjs | tee /tmp/r9-02-architecture.tap
grep -q '# tests 6' /tmp/r9-02-architecture.tap
grep -q '# pass 6' /tmp/r9-02-architecture.tap
grep -q '# fail 0' /tmp/r9-02-architecture.tap

node --test tests/stage-09-scroll-contract-freeze.test.mjs | tee /tmp/r9-01-behavior.tap
grep -q '# tests 8' /tmp/r9-01-behavior.tap
grep -q '# pass 8' /tmp/r9-01-behavior.tap
grep -q '# fail 0' /tmp/r9-01-behavior.tap
node --test tests/architecture/stage-09-scroll-contract-freeze.test.mjs | tee /tmp/r9-01-architecture.tap
grep -q '# tests 5' /tmp/r9-01-architecture.tap
grep -q '# pass 5' /tmp/r9-01-architecture.tap
grep -q '# fail 0' /tmp/r9-01-architecture.tap

node --test tests/stage-08*.test.mjs tests/architecture/stage-08*.test.mjs | tee /tmp/stage-08.tap
grep -q '# tests 179' /tmp/stage-08.tap
grep -q '# pass 179' /tmp/stage-08.tap
grep -q '# fail 0' /tmp/stage-08.tap

npm test | tee /tmp/node.tap
node_tests="$(awk '/^# tests /{v=$3} END{print v}' /tmp/node.tap)"
node_pass="$(awk '/^# pass /{v=$3} END{print v}' /tmp/node.tap)"
node_fail="$(awk '/^# fail /{v=$3} END{print v}' /tmp/node.tap)"
test -n "$node_tests"
test "$node_tests" = "$node_pass"
test "$node_fail" = '0'

npm run verify:architecture
npm run test:browser:contract | tee /tmp/browser-contract.log
grep -Eq '10[^0-9]+10|10/10|passed: 10' /tmp/browser-contract.log
npm run build

for attempt in 1 2; do
  echo "Built-app attempt $attempt"
  npm run test:browser | tee "/tmp/built-app-$attempt.log"
  grep -q 'Browser tests: 29, passed: 29, failed: 0' "/tmp/built-app-$attempt.log"
done

cat > README.md <<EOF
# Markdown Editor

简介：模块化重写中的桌面 Markdown 编辑器；详见 [docs/README.md](docs/README.md)。

R9-08：SelectionFeedbackGuard 以 sequence/source/revision 接管双向反馈，删除旧 applyingSide/releaseTimer/selectionSyncLock；R9-09+ 未启动，行为不变。验证：R9-08 16/16；R9-07 15/15；R9-06 14/14；R9-05 16/16；R9-04 14/14；R9-03~R9-01 13/13；Stage8 179/179；Node ${node_tests}/${node_pass}；Architecture/Build PASS；Browser 10/10；Built-app 29/29×2；audit 0。
EOF
node --test tests/documentation-layout.test.mjs | tee /tmp/documentation.tap
grep -q '# fail 0' /tmp/documentation.tap

git diff --check

# Final scope audit. Historical tests may only remove the now-current later-file assertion or move cardinality 378 -> 379.
python - <<'PY'
import subprocess
baseline = 'ff66d2eaa4cd030977cc3c4e57bc886e95d4110a'
changed = subprocess.check_output(['git', 'diff', '--name-only', baseline], text=True).splitlines()
explicit = {
    'README.md',
    'public/app/core.js',
    'public/app/scroll-sync.js',
    'src/features/sync/index.js',
    'src/features/sync/selection/selection-feedback-guard.js',
    'src/main.js',
    'src/sync/selection-controller.js',
    'tests/architecture/fixtures/production-modules.json',
    'tests/stage-09-selection-feedback-guard.test.mjs',
    'tests/architecture/stage-09-selection-feedback-guard.test.mjs',
    '.github/workflows/stage-07-atomic.yml',
}
for path in changed:
    if path.startswith('.agent/r9_08_'):
        continue
    if path in explicit:
        continue
    if path.startswith('tests/') and path.endswith('.mjs'):
        diff = subprocess.check_output(['git', 'diff', '--unified=0', baseline, '--', path], text=True).splitlines()
        edits = [line for line in diff if line.startswith(('+', '-')) and not line.startswith(('+++', '---'))]
        allowed_tokens = ('selection-feedback-guard.js', 'modules.length, 378', 'modules.length, 379', 'inventory.modules.length, 378', 'inventory.modules.length, 379')
        if edits and all(any(token in line for token in allowed_tokens) for line in edits):
            continue
    raise SystemExit(f'Unexpected R9-08 path or non-mechanical historical edit: {path}')
PY

node -e "const x=require('./tests/architecture/fixtures/production-modules.json'); if(x.modules.length!==379) process.exit(1); const m=new Map(x.modules.map(r=>[r[0],r])); if(m.get('src/features/sync/selection/selection-feedback-guard.js')?.[4]!=='selection-feedback-guard-lifecycle') process.exit(2)"
grep -q 'R9-08' README.md
grep -q 'R9-08 16/16' README.md
grep -q 'R9-07 15/15' README.md
grep -q 'Stage8 179/179' README.md
grep -q "Node ${node_tests}/${node_pass}" README.md
grep -q 'Built-app 29/29×2' README.md
for path in \
  src/features/sync/selection/selection-sync-controller.js \
  src/features/sync/selection/selection-highlight-session.js \
  src/features/sync/selection/selection-retry-scheduler.js; do
  test ! -e "$path"
done
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .

# Restore the permanent workflow exactly to R9-07, remove every temporary R9-08 validation artifact, and publish only the clean candidate.
git checkout "$baseline" -- "$workflow_path"
rm -f .agent/r9_08_apply.py .agent/r9_08_validate.sh .agent/r9_08_failure.log
! find . -path './.git' -prune -o -name '__pycache__' -print | grep -q .
git diff --check

# No temporary runner/workflow changes may survive the final diff.
test -z "$(git diff --name-only "$baseline" -- .agent .github/workflows)"

git add README.md public/app/core.js public/app/scroll-sync.js src/features/sync/index.js \
  src/features/sync/selection/selection-feedback-guard.js src/main.js src/sync/selection-controller.js \
  tests/architecture/fixtures/production-modules.json tests/stage-09-selection-feedback-guard.test.mjs \
  tests/architecture/stage-09-selection-feedback-guard.test.mjs tests

git status --short
GIT_AUTHOR_NAME='atomic-runner' GIT_AUTHOR_EMAIL='atomic-runner@users.noreply.github.com' \
GIT_COMMITTER_NAME='atomic-runner' GIT_COMMITTER_EMAIL='atomic-runner@users.noreply.github.com' \
  git commit -m 'refactor: complete R9-08 selection feedback guard'

git push --force-with-lease="refs/heads/${validated_branch}:$(git ls-remote origin "refs/heads/${validated_branch}" | awk '{print $1}')" \
  origin HEAD:"refs/heads/${validated_branch}" 2>/tmp/r9-08-push.err || {
    if grep -q 'stale info' /tmp/r9-08-push.err; then cat /tmp/r9-08-push.err; exit 1; fi
    if git ls-remote --exit-code origin "refs/heads/${validated_branch}" >/dev/null 2>&1; then
      cat /tmp/r9-08-push.err
      exit 1
    fi
    git push origin HEAD:"refs/heads/${validated_branch}"
  }
