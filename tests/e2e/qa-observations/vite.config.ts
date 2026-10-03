import { defineConfig, mergeConfig } from 'vite'
import { resolve } from 'node:path'
import appConfig from '../../../apps/electron/vite.config'

const doubles = new Set([
  '@/context/AppShellContext', '@/actions', '@/components/ui/EditPopover',
  '@/components/ui/skill-avatar', './SkillMenu', '@/components/app-shell/SkillMenu',
  './SendResourceToWorkspaceDialog', './MainContentPanel', '@/components/app-shell/PanelHeader',
  '@/contexts/NavigationContext', '../memory/MemoryScreen', './ProjectsHomeInMain',
  './collection/CollectionBulkBar', '@/pages/ChatPage', '@/platform/HomeFrontPage',
  '@/pages/settings/settings-pages', '@/pages/settings/SettingsOverviewPage',
  '../pages/PageView', './session-heatmap/SessionHeatmapHost', '../../knowledge/KnowledgeHome',
  '@/lib/settings-recent',
])
for (const id of [...doubles]) {
  if (id.startsWith('@/')) doubles.add(resolve(__dirname, '../../../apps/electron/src/renderer', id.slice(2)).replace(/\\/g, '/'))
}
export default mergeConfig(appConfig, defineConfig({
  root: __dirname,
  cacheDir: resolve(__dirname, '../../../node_modules/.qa-observations-vite'),
  plugins: [{ name: 'isolated-qa-boundaries', enforce: 'pre', resolveId(id) {
    return doubles.has(id.replace(/\\/g, '/')) ? resolve(__dirname, 'stubs.tsx') : null
  } }],
  optimizeDeps: { entries: [resolve(__dirname, 'index.html')] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true,
    proxy: { '/qa-rpc': 'http://127.0.0.1:5189' } },
}))
