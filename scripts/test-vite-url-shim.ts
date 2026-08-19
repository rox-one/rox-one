/**
 * Test-only shim for Vite's `?url` import suffix.
 *
 * Renderer code imports the pdf.js worker as `...pdf.worker.min.mjs?url`, which
 * Vite turns into a URL string at build time. Bun has no such transform, so it
 * loads the real `.mjs` and throws `Missing 'default' export` — aborting the
 * whole test file, not just the assertion. Any test whose import graph reaches
 * a renderer component hits this, which is why individual suites had started
 * repeating the same `mock.module` call.
 *
 * `pdfjs-dist` itself is stubbed for the same reason: its module body builds a
 * `DOMMatrix` at import time, which does not exist under Bun's test runtime.
 * No suite exercises PDF rendering — the two that reached it already stubbed
 * the module by hand to get past the import.
 *
 * Wired through `[test].preload` in `bunfig.toml`.
 */
import { mock } from 'bun:test';

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}));
