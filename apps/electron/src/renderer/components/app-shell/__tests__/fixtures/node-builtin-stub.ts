import { resolve } from 'node:path'
import type { Plugin } from 'vite'

// Bare specifiers the renderer shim may be substituted for. `buffer` and
// `process` stay bare-only: the shim imports the browser polyfills by those
// exact names, so mapping them would make the shim its own dependency.
const bare = new Set([
  'fs', 'fs/promises', 'path', 'os', 'crypto', 'child_process', 'url', 'util',
  'stream', 'events', 'module', 'assert', 'worker_threads', 'http', 'https',
  'net', 'tls', 'dns', 'zlib', 'querystring', 'string_decoder', 'readline',
  'tty', 'constants', 'vm', 'perf_hooks', 'async_hooks', 'timers',
])
const prefixed = new Set([...bare, 'buffer', 'process'])

/**
 * Mirror the shipped renderer's node-builtin boundary for fixture servers.
 *
 * Fixtures bundle real renderer modules for the browser; shared code may reach
 * `node:*` transitively and must land on the renderer shim instead of Vite's
 * externalized-module proxy (see the same mapping in apps/electron/vite.config.ts).
 */
export function nodeBuiltinStubPlugin(repository: string): Plugin {
  const stub = resolve(repository, 'apps/electron/src/renderer/shims/node-stub.ts')
  return {
    name: 'fixture-node-builtin-stub',
    enforce: 'pre',
    resolveId(id) {
      const clean = (id.split('?')[0] || id).replace(/^\0/, '')
      if (clean.startsWith('node:')) return prefixed.has(clean.slice(5)) ? stub : null
      const base = clean.replace(/^.*node_modules\//, '')
      return bare.has(base) ? stub : null
    },
  }
}