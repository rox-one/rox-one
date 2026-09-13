/**
 * Playground-only Node globals. Shared config/credentials modules still
 * touch `process` and `Buffer` at import time; the Electron renderer gets
 * those from the host, the browser does not.
 */
import { Buffer as BrowserBuffer } from 'buffer'
import browserProcess from 'process'

const root = globalThis as typeof globalThis & {
  Buffer?: typeof BrowserBuffer
  process?: NodeJS.Process
}

if (!root.Buffer) root.Buffer = BrowserBuffer
if (!(root as typeof globalThis & { global?: typeof globalThis }).global) {
  (root as typeof globalThis & { global?: typeof globalThis }).global = globalThis
}

const base = (root.process ?? browserProcess) as NodeJS.Process
root.process = Object.assign(base, {
  argv: Array.isArray(base.argv) ? base.argv : [],
  env: base.env ?? {},
  cwd: typeof base.cwd === 'function' ? base.cwd.bind(base) : () => '/',
  platform: base.platform || 'linux',
  versions: base.versions ?? { node: '22.0.0' },
  nextTick: typeof base.nextTick === 'function'
    ? base.nextTick.bind(base)
    : (cb: () => void) => queueMicrotask(cb),
}) as NodeJS.Process
