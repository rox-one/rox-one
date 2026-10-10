import { defineConfig, type UserConfig } from 'vite'
import { resolve } from 'node:path'
import rendererConfig from '../../../../../../../vite.config'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../../..')
// The production config is a `defineConfig(({ command }) => …)` function
// (aliases/plugins live inside it) — invoke it instead of spreading the function.
const base = (typeof rendererConfig === 'function'
  ? (rendererConfig as (env: { command: 'build'; mode: string }) => UserConfig)({ command: 'build', mode: 'production' })
  : rendererConfig) as UserConfig
export default defineConfig({ ...base, root, cacheDir: resolve(repository, 'apps/electron/.vite-worktree/radar-fixture'),
  server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } } })
