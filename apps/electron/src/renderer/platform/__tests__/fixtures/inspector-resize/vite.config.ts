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
    cacheDir: process.env.INSPECTOR_RESIZE_VITE_CACHE
      ?? resolve(tmpdir(), `rox-inspector-resize-fixture-${process.pid}`),
    resolve: {
      ...production.resolve,
      alias: [
        { find: '@/shared/routes', replacement: resolve(repository, 'apps/electron/src/shared/routes.ts') },
        { find: '@/context/AppShellContext', replacement: resolve(root, 'context.ts') },
        { find: '@/contexts/NavigationContext', replacement: resolve(root, 'navigation.ts') },
        { find: '@/components/session-inspector/SessionInspectorBody', replacement: resolve(root, 'leaves.tsx') },
        { find: '@/components/session-inspector/InspectorBrowserPane', replacement: resolve(root, 'leaves.tsx') },
        { find: '@/components/session-inspector/InspectorTerminal', replacement: resolve(root, 'leaves.tsx') },
        ...Object.entries(production.resolve?.alias ?? {}).map(([find, replacement]) => ({ find, replacement: replacement as string })),
      ],
      dedupe: ['react', 'react-dom', 'jotai'],
    },
    optimizeDeps: {
      ...production.optimizeDeps,
      entries: [resolve(root, 'index.html')],
    },
    server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
  }
})
