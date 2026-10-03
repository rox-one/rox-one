import { defineConfig } from 'vite'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import rendererConfig from '../../../apps/electron/vite.config'

const root = resolve(__dirname, '../../..')
const maps = ['core', 'shared', 'ui'].map(name => ({
  name: `@rox/${name}`, dir: resolve(root, 'packages', name),
  exports: JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8')).exports as Record<string, string>,
}))
export default defineConfig({
  root: __dirname, cacheDir: resolve(root, 'node_modules/.vite/runtime-map-e2e'),
  plugins: [{
    name: 'runtime-map-worktree-packages', enforce: 'pre',
    resolveId(id) {
      for (const item of maps) {
        if (id !== item.name && !id.startsWith(`${item.name}/`)) continue
        const key = id === item.name ? '.' : `.${id.slice(item.name.length)}`
        let target = item.exports[key]
        if (!target) for (const [pattern, value] of Object.entries(item.exports)) {
          if (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1))) target = value.replace('*', key.slice(pattern.length - 1))
        }
        if (target) {
          const path = resolve(item.dir, target)
          return [path, `${path}.ts`, `${path}.tsx`, resolve(path, 'index.ts')].find(existsSync) ?? path
        }
      }
    },
  }, ...(rendererConfig.plugins ?? [])],
  resolve: { alias: { ...rendererConfig.resolve?.alias as Record<string, string>, '@': resolve(root, 'apps/electron/src/renderer'),
    react: resolve(root, 'node_modules/react'), 'react-dom': resolve(root, 'node_modules/react-dom') }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 4176, strictPort: true, fs: { allow: [root, dirname(realpathSync(resolve(root, 'node_modules')))] } },
  define: { global: 'globalThis' },
  build: { outDir: resolve(root, 'node_modules/.cache/runtime-map-e2e-build'), emptyOutDir: true, sourcemap: process.env.ROX_RUNTIME_PROFILE === '1' },
  optimizeDeps: rendererConfig.optimizeDeps,
})
