import test from 'node:test';
import assert from 'node:assert/strict';
import { getNativeParentPath, isNativePathWithinDirectory, isSameNativePath, normalizeNativePath } from '../../../src/features/sidebar/index.js';

test('Folder Tree path policy preserves Windows and POSIX comparison semantics', () => {
  assert.equal(normalizeNativePath(' F:\\Notes\\daily\\ '), 'F:/Notes/daily');
  assert.equal(getNativeParentPath('F:\\Notes\\daily\\today.md'), 'F:\\Notes\\daily');
  assert.equal(getNativeParentPath('/home/user/notes/today.md'), '/home/user/notes');
  assert.equal(isSameNativePath('F:\\Notes\\Today.MD', 'f:/notes/today.md'), true);
  assert.equal(isNativePathWithinDirectory('F:\\Notes\\Archive\\old.md', 'f:/notes'), true);
  assert.equal(isNativePathWithinDirectory('F:\\Other\\old.md', 'f:/notes'), false);
  assert.equal(isSameNativePath('/Notes/Today.md', '/notes/today.md'), false);
});
