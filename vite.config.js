import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const PARENT_NODE_MODULES = resolve(PROJECT_ROOT, '..', 'node_modules');

const INITIAL_CHUNK_LIMIT_BYTES = 500_000;
const ASYNC_CHUNK_LIMIT_BYTES = 700_000;

function vendorChunkName(id) {
  const path = id.replaceAll('\\', '/');
  if (!path.includes('/node_modules/')) return undefined;

  if (path.includes('/node_modules/@codemirror/')) return 'codemirror-vendor';
  if (path.includes('/node_modules/@lezer/')) return 'lezer-vendor';
  if (path.includes('/node_modules/katex/')) return 'katex-vendor';
  if (path.includes('/node_modules/marked/')) return 'marked-vendor';
  if (path.includes('/node_modules/@tauri-apps/')) return 'tauri-vendor';
  if (path.includes('/node_modules/dompurify/')) return 'sanitizer-vendor';
  if (/\/node_modules\/d3(?:-|\/)/.test(path)) return 'd3-vendor';

  return undefined;
}

function bundleBudgetPlugin() {
  return {
    name: 'bundle-budget',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle)
          .filter(output => output.type === 'chunk')
          .map(chunk => [chunk.fileName, chunk])
      );
      const initialChunks = new Set();

      const visitInitialChunk = fileName => {
        if (initialChunks.has(fileName)) return;
        const chunk = chunks.get(fileName);
        if (!chunk) return;
        initialChunks.add(fileName);
        for (const importedFile of chunk.imports) visitInitialChunk(importedFile);
      };

      for (const chunk of chunks.values()) {
        if (chunk.isEntry) visitInitialChunk(chunk.fileName);
      }

      const violations = [];
      for (const chunk of chunks.values()) {
        const bytes = Buffer.byteLength(chunk.code);
        const initial = initialChunks.has(chunk.fileName);
        const limit = initial ? INITIAL_CHUNK_LIMIT_BYTES : ASYNC_CHUNK_LIMIT_BYTES;
        if (bytes > limit) {
          violations.push(`${chunk.fileName}: ${bytes} bytes > ${limit} byte ${initial ? 'initial' : 'async'} budget`);
        }
      }

      if (violations.length > 0) {
        this.error(`[bundle-budget] ${violations.join('; ')}`);
      }
    }
  };
}

export default defineConfig({
  clearScreen: false,
  cacheDir: '../node_modules/.vite/markdown-editor',
  plugins: [bundleBudgetPlugin()],
  server: {
    host: '127.0.0.1',
    port: 16663,
    strictPort: true,
    fs: {
      allow: [PROJECT_ROOT, PARENT_NODE_MODULES]
    },
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: ASYNC_CHUNK_LIMIT_BYTES / 1000,
    rollupOptions: {
      output: {
        manualChunks: vendorChunkName
      }
    }
  }
});
