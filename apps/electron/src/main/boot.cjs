'use strict'
/**
 * #1573 — Electron main entry shim. Turns on Node's on-disk V8 compile cache
 * before loading the (large, single-file) main bundle, so warm launches skip
 * re-parsing/compiling main.cjs. Must stay tiny and dependency-free: it is
 * the one file that is always compiled cold.
 *
 * Cache dir: `<tmp>/rox-compile-cache` (Node keys entries by file path +
 * content hash + V8 version, so app updates invalidate naturally). Opt out
 * with ROX_DISABLE_COMPILE_CACHE=1 (also honours NODE_DISABLE_COMPILE_CACHE).
 */
try {
  const mod = require('node:module')
  if (typeof mod.enableCompileCache === 'function' && !process.env.ROX_DISABLE_COMPILE_CACHE) {
    const { join } = require('node:path')
    const { tmpdir } = require('node:os')
    mod.enableCompileCache(join(tmpdir(), 'rox-compile-cache'))
  }
} catch {
  // Never block startup on the cache.
}
require('./main.cjs')
