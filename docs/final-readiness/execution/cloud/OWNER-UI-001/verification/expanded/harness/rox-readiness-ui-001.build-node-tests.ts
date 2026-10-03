import { build } from 'esbuild'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
function repositoryRoot(start: string): string {
  for (let path = start; ; path = dirname(path)) {
    if (existsSync(join(path, 'apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx')) && existsSync(join(path, 'bunfig.toml'))) return path
    if (dirname(path) === path) throw new Error('Repository root unavailable')
  }
}
const root = repositoryRoot(import.meta.dir)
const file = resolve(root, process.argv[2])
const output = resolve(root, process.argv[3])
await build({
  entryPoints: [file], bundle: true, packages: 'external', platform: 'node', format: 'esm', outfile: output,
  define: { 'import.meta.dir': JSON.stringify(dirname(file)) },
  plugins: [{ name: 'explicit-node-assert-adapter', setup(plugin) {
    plugin.onResolve({ filter: /^bun:test$/ }, () => ({ path: join(import.meta.dir, 'rox-readiness-ui-001.node-adapter.mjs') }))
  } }],
  footer: { js: 'await globalThis.__ui001NodeRun();' },
})
