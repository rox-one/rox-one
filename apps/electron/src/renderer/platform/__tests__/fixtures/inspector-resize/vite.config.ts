import { defineConfig, loadConfigFromFile, type Plugin } from 'vite'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../..')
const electronRenderer = resolve(repository, 'apps/electron/src/renderer')
const reactRoot = resolve(repository, 'node_modules/react')
const reactDomRoot = resolve(repository, 'node_modules/react-dom')
const roxUiStub = resolve(root, 'rox-ui-stub.tsx')

const fixtureModuleStubs: Record<string, string> = {
  '@/context/AppShellContext': resolve(root, 'context.ts'),
  '@/contexts/NavigationContext': resolve(root, 'navigation.ts'),
  '@/components/session-inspector/SessionInspectorBody': resolve(root, 'leaves.tsx'),
  '@/components/session-inspector/InspectorBrowserPane': resolve(root, 'leaves.tsx'),
  '@/components/session-inspector/InspectorTerminal': resolve(root, 'leaves.tsx'),
}

function productionAliasEntries(production: { resolve?: { alias?: Record<string, string> } }) {
  return Object.entries(production.resolve?.alias ?? {})
    .filter(([find]) => find !== 'react' && find !== 'react-dom' && find !== '@')
    .map(([find, replacement]) => ({ find, replacement: replacement as string }))
}

function inspectorFixtureModuleStubPlugin(): Plugin {
  return {
    name: 'inspector-fixture-module-stubs',
    enforce: 'pre',
    resolveId(id) {
      const clean = (id.split('?')[0] || id).replace(/\\/g, '/')
      if (clean === '@rox/ui') return roxUiStub
      const stub = fixtureModuleStubs[clean]
      if (stub) return stub
      // optimizeDeps / @fs paths can bypass @/ aliases; still force fixture stubs.
      if (clean.includes('/contexts/NavigationContext')) return fixtureModuleStubs['@/contexts/NavigationContext']
      if (clean.includes('/context/AppShellContext')) return fixtureModuleStubs['@/context/AppShellContext']
      if (clean.includes('/session-inspector/SessionInspectorBody')) return fixtureModuleStubs['@/components/session-inspector/SessionInspectorBody']
      if (clean.includes('/session-inspector/InspectorBrowserPane')) return fixtureModuleStubs['@/components/session-inspector/InspectorBrowserPane']
      if (clean.includes('/session-inspector/InspectorTerminal')) return fixtureModuleStubs['@/components/session-inspector/InspectorTerminal']
      return null
    },
  }
}

export default defineConfig(async environment => {
  const loaded = await loadConfigFromFile(environment, resolve(repository, 'apps/electron/vite.config.ts'))
  if (!loaded) throw new Error('Current production renderer configuration unavailable')
  const production = loaded.config
  const productionPlugins = Array.isArray(production.plugins) ? production.plugins : []
  return {
    ...production,
    root,
    cacheDir: process.env.INSPECTOR_RESIZE_VITE_CACHE
      ?? resolve(tmpdir(), `rox-inspector-resize-fixture-${process.pid}`),
    plugins: [inspectorFixtureModuleStubPlugin(), ...productionPlugins],
    resolve: {
      ...production.resolve,
      alias: [
        { find: '@/shared/routes', replacement: resolve(repository, 'apps/electron/src/shared/routes.ts') },
        ...Object.entries(fixtureModuleStubs).map(([find, replacement]) => ({ find, replacement })),
        ...productionAliasEntries(production as { resolve?: { alias?: Record<string, string> } }),
        { find: '@', replacement: electronRenderer },
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
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
        ]),
      ],
    },
    define: {
      ...production.define,
      'process.env.NODE_ENV': JSON.stringify('test'),
    },
    server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
  }
})
