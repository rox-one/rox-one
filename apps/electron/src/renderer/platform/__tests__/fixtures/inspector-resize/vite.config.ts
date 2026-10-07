import { defineConfig, loadConfigFromFile } from 'vite'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../..')
const reactRoot = resolve(repository, 'node_modules/react')
const reactDomRoot = resolve(repository, 'node_modules/react-dom')

function productionAliasEntries(production: { resolve?: { alias?: Record<string, string> } }) {
  return Object.entries(production.resolve?.alias ?? {})
    .filter(([find]) => find !== 'react' && find !== 'react-dom')
    .map(([find, replacement]) => ({ find, replacement: replacement as string }))
}

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
        ...productionAliasEntries(production),
        { find: '@/shared/routes', replacement: resolve(repository, 'apps/electron/src/shared/routes.ts') },
        { find: '@/context/AppShellContext', replacement: resolve(root, 'context.ts') },
        { find: '@/contexts/NavigationContext', replacement: resolve(root, 'navigation.ts') },
        { find: '@/components/session-inspector/SessionInspectorBody', replacement: resolve(root, 'leaves.tsx') },
        { find: '@/components/session-inspector/InspectorBrowserPane', replacement: resolve(root, 'leaves.tsx') },
        { find: '@/components/session-inspector/InspectorTerminal', replacement: resolve(root, 'leaves.tsx') },
        { find: 'react', replacement: reactRoot },
        { find: 'react/jsx-runtime', replacement: resolve(reactRoot, 'jsx-runtime.js') },
        { find: 'react/jsx-dev-runtime', replacement: resolve(reactRoot, 'jsx-dev-runtime.js') },
        { find: 'react-dom', replacement: reactDomRoot },
        { find: 'react-dom/client', replacement: resolve(reactDomRoot, 'client.js') },
      ],
      dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'jotai'],
    },
    optimizeDeps: {
      ...production.optimizeDeps,
      entries: [resolve(root, 'index.html')],
      include: [
        ...new Set([
          ...(production.optimizeDeps?.include ?? []),
          'react',
          'react-dom',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'jotai',
        ]),
      ],
    },
    server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
  }
})
