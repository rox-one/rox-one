import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import base from '../../../../../../../vite.config'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../../..')
export default defineConfig({ ...base, root, cacheDir: resolve(repository, 'apps/electron/.vite-worktree/radar-fixture'),
  server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } } })
