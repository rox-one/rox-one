import { defineConfig, loadConfigFromFile } from 'vite'
import { resolve } from 'node:path'

const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../../../..')
export default defineConfig(async () => {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, resolve(repository, 'apps/electron/vite.config.ts'))
  return {
    ...loaded!.config, root, cacheDir: resolve(root, '.vite'),
    server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
  }
})
