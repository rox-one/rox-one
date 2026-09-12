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

// react-pdf reads window.location.protocol at import time. Bun's test
// runtime (and late happy-dom installs) can expose `window` without `location`.
const stubLocation = {
  protocol: 'http:',
  href: 'http://localhost/',
  hostname: 'localhost',
  host: 'localhost',
  pathname: '/',
  search: '',
  hash: '',
  origin: 'http://localhost',
  assign() {},
  replace() {},
  reload() {},
  toString() {
    return this.href;
  },
};

function ensureLocation(win: object | null | undefined): void {
  if (win == null || typeof win !== 'object') return;
  const current = (win as { location?: { protocol?: unknown } }).location;
  if (current != null && typeof current.protocol === 'string') return;
  try {
    Object.defineProperty(win, 'location', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: stubLocation,
    });
  } catch {
    try {
      (win as { location: unknown }).location = stubLocation;
    } catch {
      // ignore non-configurable hosts
    }
  }
}

ensureLocation((globalThis as { window?: object }).window);
if (typeof (globalThis as { location?: unknown }).location === 'undefined') {
  try {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: stubLocation,
    });
  } catch {
    // ignore
  }
}

try {
  let stored = (globalThis as { window?: object }).window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    enumerable: true,
    get() {
      if (stored) ensureLocation(stored);
      return stored;
    },
    set(value: object | undefined) {
      stored = value;
      if (stored) ensureLocation(stored);
    },
  });
} catch {
  ensureLocation((globalThis as { window?: object }).window);
}

mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '' }));
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({}),
}));
mock.module('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}));
