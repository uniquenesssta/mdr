
test('Stage 1 completion record is grounded in verified artifacts', async () => {
  const readme = await readText('README.md');
  assert.equal((readme.match(/<!-- stage-01-node:01-10 -->/g) || []).length, 1);
  assert.match(readme, /30986994815/);
  assert.match(readme, /30986994863/);
  assert.match(readme, /阶段 1 已完成，阶段 2 尚未开始/);

  const record = await readText('docs/rewrite-progress/stage-01/01-10-stage-01-handoff.md');
  for (const statement of [
    '结果：**通过**',
    '阶段 1 已完成；阶段 2 尚未开始',
    '30986994815',
    '8922490798',
    'sha256:8b8f93b82d14ee49b8b8cd9e586299f82ac74acb34cd0697954da66174e80e15',
    '30986994863',
    '8922713210',
    'sha256:07e4037f5d63bf7b42c5d2b3f7970e5e2ad6e51f7a4e6c2e40bb2cf15fdb4109',
    'Windows 原生路径仍需要真实平台回归',
    '2 个 audit advisory'
  ]) {
    assert.match(record, new RegExp(statement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
