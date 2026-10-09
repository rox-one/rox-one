import { defineConfig, type UserConfig } from 'vite'
import { resolve } from 'node:path'
import rendererConfig from '../../../../../../vite.config'

const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../..')

// Retain the renderer's production aliases, package resolver, Tailwind plugin
// and browser-safe node stubs. The real @rox/ui Markdown and the lazy OpenUI
// chunk are compiled exactly as the app ships them — nothing is mocked.
const production = rendererConfig as UserConfig
export default defineConfig({
  ...production,
  root,
  cacheDir: resolve(repository, 'node_modules/.vite-openui-block'),
  build: {
    ...production.build,
    outDir: resolve(repository, 'node_modules/.vite-openui-block/compiled-fixture'),
    emptyOutDir: true,
    rollupOptions: { ...production.build?.rollupOptions, input: resolve(root, 'index.html') },
  },
  preview: { host: '127.0.0.1', strictPort: true, open: false },
  server: { host: '127.0.0.1', strictPort: true, open: false, hmr: false, watch: null, fs: { allow: [repository] } },
})