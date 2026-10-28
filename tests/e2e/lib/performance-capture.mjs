import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Test-owned CPU/timeline capture. No product instrumentation or persisted app settings.
export async function capturePerformance(page, artifacts, action) {
  const cdp = page.connection;
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  const completion = new Promise(resolve => {
    const off = cdp.on('Tracing.tracingComplete', event => { off(); resolve(event); });
  });
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline.stack', transferMode: 'ReturnAsStream' });
  await cdp.send('Profiler.start');
  try { return await action(); }
  finally {
    const { profile } = await cdp.send('Profiler.stop');
    await writeFile(join(artifacts, 'interaction.cpuprofile'), JSON.stringify(profile));
    await cdp.send('Tracing.end');
    const { stream } = await completion;
    let trace = '';
    try {
      for (;;) {
        const chunk = await cdp.send('IO.read', { handle: stream, size: 1048576 });
        trace += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
        if (chunk.eof) break;
      }
    } finally { await cdp.send('IO.close', { handle: stream }); }
    await writeFile(join(artifacts, 'interaction.trace.json'), trace);
    await cdp.send('Profiler.disable');
  }
}
