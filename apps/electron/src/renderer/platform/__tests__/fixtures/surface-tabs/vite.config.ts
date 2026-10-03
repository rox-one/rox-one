import { defineConfig, loadConfigFromFile } from 'vite'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../..')
export default defineConfig(async environment => {
  const loaded = await loadConfigFromFile(environment, resolve(repository, 'apps/electron/vite.config.ts'))
  if (!loaded) throw new Error('Current production renderer configuration unavailable')
  const production = loaded.config
  return {
    ...production,
    root,
    cacheDir: resolve(tmpdir(), 'rox-surface-tabs-fixture-20261003'),
    resolve: {
      ...production.resolve,
      alias: [
        { find: '@/context/AppShellContext', replacement: resolve(root, 'context.ts') },
        ...Object.entries(production.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement: replacement as string })),
      ],
      dedupe: ['react', 'react-dom', 'jotai'],
    },
    server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
  }
})
