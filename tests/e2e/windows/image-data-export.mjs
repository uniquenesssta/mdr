import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Real public encoder -> Platform -> Rust safe writer; only the harness-owned temporary root. */
export async function verifyImageDataExport({ browser, ownedRoot, commit }) {
  const allBytes = Buffer.from(Array.from({ length: 65537 }, (_, i) => i % 256));
  const unicode = Buffer.from('编码😀𠮷\uFEFF\uD800', 'utf8');
  const rows = [
    { name: 'base64-全字节😀.png', url: 'data:application/octet-stream;base64,' + allBytes.toString('base64'), bytes: allBytes },
    { name: 'percent-全字节.png', url: 'data:application/octet-stream,' + Array.from({ length: 256 }, (_, i) => '%' + i.toString(16).padStart(2, '0')).join(''), bytes: allBytes.subarray(0, 256) },
    { name: 'unicode.png', url: 'data:text/plain,编码😀𠮷\uFEFF', loneSurrogate: true, bytes: unicode }
  ];
  const observations = [];
  for (const row of rows) {
    const path = join(ownedRoot, row.name);
    const result = await browser.inspect(async (source, destination, loneSurrogate) => {
      const host = applicationCapabilities;
      const platform = host.markdownEditorPlatformPort;
      if (!platform.capabilities.desktop.fileSystem) throw new Error('Real native binary writer is unavailable.');
      const bytes = host.markdownEditorImageDataPort.encode(source + (loneSurrogate ? String.fromCharCode(0xD800) : ''));
      await platform.files.writeBinary( destination, bytes, { extension: 'png', reason: 'export' });
      return { byteLength: bytes.byteLength, typed: bytes instanceof Uint8Array };
    }, row.url, path, Boolean(row.loneSurrogate));
    const actual = await readFile(path);
    assert.deepEqual(actual, row.bytes); assert.equal(result.byteLength, row.bytes.length); assert.equal(result.typed, true);
    observations.push({ name: row.name, byteLength: actual.length, sha256: createHash('sha256').update(actual).digest('hex'), exactBytes: true });
  }
  // Generate actual PNG pixels in WebView, then save the public encoder's bytes through Rust.
  const pngPath = join(ownedRoot, 'actual-pixels.png');
  const png = await browser.inspect(async destination => {
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2;
    canvas.getContext('2d').fillStyle = '#1183d3'; canvas.getContext('2d').fillRect(0, 0, 2, 2);
    const source = canvas.toDataURL('image/png'); canvas.width = 0; canvas.height = 0;
    const host = applicationCapabilities;
    await host.markdownEditorPlatformPort.files.writeBinary( destination, host.markdownEditorImageDataPort.encode(source), { extension: 'png', reason: 'export' });
    return source;
  }, pngPath);
  const actualPng = await readFile(pngPath); assert.deepEqual(actualPng, Buffer.from(png.split(',')[1], 'base64'));
  observations.push({ name: 'actual-pixels.png', byteLength: actualPng.length, sha256: createHash('sha256').update(actualPng).digest('hex'), exactBytes: true, realPng: true });
  const blocked = join(ownedRoot, 'directory.png'); await mkdir(blocked);
  const failure = await browser.inspect(async destination => {
    const host = applicationCapabilities;
    try { await host.markdownEditorPlatformPort.files.writeBinary( destination, host.markdownEditorImageDataPort.encode('data:;base64,AA=='), { extension: 'png', reason: 'export' }); }
    catch { return { rejected: true }; }
    throw new Error('Native binary writer accepted a directory target.');
  }, blocked);
  assert.equal(failure.rejected, true);
  const replacement = rows[0];
  await browser.inspect(async (destination, source) => {
    const host = applicationCapabilities;
    await host.markdownEditorPlatformPort.files.writeBinary( destination, host.markdownEditorImageDataPort.encode(source), { extension: 'png', reason: 'export' });
  }, pngPath, replacement.url);
  assert.deepEqual(await readFile(pngPath), replacement.bytes);
  return { commit, status: 'passed', transport: 'public encoder -> actual Platform binary adapter -> Rust safe writer -> actual Windows file readback', observations, directoryRejected: true, nextWriteRecovered: true };
}
