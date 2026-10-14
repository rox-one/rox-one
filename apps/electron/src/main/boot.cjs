'use strict'
/**
 * #1573 — Electron main entry shim. Turns on Node's on-disk V8 compile cache
 * before loading the (large, single-file) main bundle, so warm launches skip
 * re-parsing/compiling main.cjs. Must stay tiny and dependency-free: it is
 * the one file that is always compiled cold.
 *
 * Cache dir is per-user and app-owned (never shared /tmp):
 *   macOS   ~/Library/Caches/Rox/compile-cache
 *   Windows %LOCALAPPDATA%\Rox\compile-cache
 *   Linux   $XDG_CACHE_HOME/rox/compile-cache (default ~/.cache/rox/compile-cache)
 * Created with mode 0700; on POSIX the cache is skipped unless the dir is owned
 * by the current user and not group/world-writable. Node keys entries by file
 * path + content hash + V8 version, so app updates invalidate naturally.
 * Opt out with ROX_DISABLE_COMPILE_CACHE=1 (Node also honours NODE_DISABLE_COMPILE_CACHE).
 */
function compileCacheDir() {
  const { join, isAbsolute } = require('node:path')
  const os = require('node:os')
  const home = os.homedir()
  if (process.platform === 'darwin') return home ? join(home, 'Library', 'Caches', 'Rox', 'compile-cache') : null
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    return local && isAbsolute(local) ? join(local, 'Rox', 'compile-cache') : null
  }
  const xdg = process.env.XDG_CACHE_HOME
  const base = xdg && isAbsolute(xdg) ? xdg : home ? join(home, '.cache') : null
  return base ? join(base, 'rox', 'compile-cache') : null
}

/** Returns the dir when it is safe to use, else null. */
function prepareCacheDir(dir) {
  const fs = require('node:fs')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return dir
  const st = fs.lstatSync(dir)
  if (!st.isDirectory()) return null
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null
  if (st.mode & 0o022) {
    try { fs.chmodSync(dir, 0o700) } catch { return null }
  }
  return dir
}

// Startup timeline hand-off (read by main/startup-marks.ts as `main:boot` + compileCache).
const boot = { atMs: require('node:perf_hooks').performance.now(), compileCache: 'unsupported' }
globalThis.__roxBoot = boot

/** Maps `enableCompileCache()`'s result onto the timeline's compileCache state. */
function cacheState(mod, result) {
  const s = mod.constants && mod.constants.compileCacheStatus
  if (!s || !result) return 'failed'
  switch (result.status) {
    case s.ENABLED:
    case s.ALREADY_ENABLED: return 'enabled'
    case s.DISABLED: return 'disabled' // NODE_DISABLE_COMPILE_CACHE
    case s.FAILED: return 'failed'
    default: return 'failed'
  }
}

try {
  const mod = require('node:module')
  if (process.env.ROX_DISABLE_COMPILE_CACHE === '1') {
    boot.compileCache = 'disabled'
  } else if (typeof mod.enableCompileCache === 'function') {
    const raw = compileCacheDir()
    const dir = raw && prepareCacheDir(raw)
    boot.compileCache = dir ? cacheState(mod, mod.enableCompileCache(dir)) : 'unsafe-dir'
  }
} catch {
  // Never block startup on the cache.
  boot.compileCache = 'failed'
}
require('./main.cjs')
