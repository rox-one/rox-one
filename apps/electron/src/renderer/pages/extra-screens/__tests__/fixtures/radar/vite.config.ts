import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import rendererConfig from '../../../../../../../vite.config'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../../..')
// The renderer config is a factory (defineConfig(({ command }) => …)); call it
// so the fixture keeps the full production alias/plugin set.
const base = rendererConfig({ command: 'build', mode: 'production' })
export default defineConfig({ ...base, root, cacheDir: resolve(repository, 'apps/electron/.vite-worktree/radar-fixture'),
  server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } } })
