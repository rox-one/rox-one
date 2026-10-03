import { defineConfig, mergeConfig } from 'vite'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import renderer from '../../../../../apps/webui/vite.config'

const root = import.meta.dirname
const repository = resolve(root, '../../../../..')
export default mergeConfig(renderer, defineConfig({
  root,
  cacheDir: resolve(repository, 'apps/electron/.vite-worktree/product-tour-application'),
  server: { host: '127.0.0.1', strictPort: true, hmr: false, fs: { allow: [repository, resolve(realpathSync(resolve(repository, 'node_modules')), '..')] }, proxy: {} },
  build: { outDir: resolve(repository, 'test-results/product-tour/harness-build'), rollupOptions: { input: resolve(root, 'index.html') } },
}))
