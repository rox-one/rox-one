import { defineConfig, mergeConfig } from 'vite'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import renderer from '../../../../../apps/webui/vite.config'

const root = import.meta.dirname
const repository = resolve(root, '../../../../..')
const config = mergeConfig(renderer, defineConfig({
  root,
  cacheDir: resolve(repository, 'apps/electron/.vite-worktree/product-tour-application'),
  server: { host: '127.0.0.1', strictPort: true, hmr: false, fs: { allow: [repository, resolve(realpathSync(resolve(repository, 'node_modules')), '..')] }, proxy: {} },
  build: { outDir: resolve(repository, 'test-results/product-tour/harness-build') },
}))
// Replace the production WebUI's HTML entry map instead of merging its login
// entry, which belongs to a different Vite root. Both acceptance routes are owned here.
config.build!.rollupOptions = { ...config.build!.rollupOptions, input: { app: resolve(root, 'index.html'), components: resolve(root, 'ui.html') } }
export default config
