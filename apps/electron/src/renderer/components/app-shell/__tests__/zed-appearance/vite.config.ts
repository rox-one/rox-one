import { defineConfig, type UserConfig } from 'vite'
import { resolve } from 'node:path'
import rendererConfig from '../../../../../../vite.config'

const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../..')

// Retain the renderer's production aliases, package resolver, Tailwind plugin
// and browser-safe node stubs. No appearance styles or components are mocked.
const production = rendererConfig as UserConfig
export default defineConfig({
  ...production,
  root,
  cacheDir: resolve(repository, 'node_modules/.vite-zed-appearance'),
  build: {
    ...production.build,
    outDir: resolve(repository, 'node_modules/.vite-zed-appearance/compiled-fixture'),
    emptyOutDir: true,
    rollupOptions: { ...production.build?.rollupOptions, input: resolve(root, 'index.html') },
  },
  preview: { host: '127.0.0.1', strictPort: true, open: false },
  server: { host: '127.0.0.1', strictPort: true, open: false, hmr: false, watch: null, fs: { allow: [repository] } },
})
