import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../..')
export default defineConfig({ root, cacheDir: resolve(repository, 'apps/electron/.vite-worktree/auth-profile-fixture'), plugins: [react(), tailwindcss()], resolve: {
  alias: [
    { find: '@/context/AppShellContext', replacement: resolve(root, 'context.ts') },
    { find: '@/components/settings', replacement: resolve(root, 'settings.ts') },
    { find: '@/components/app-shell/PanelHeader', replacement: resolve(root, 'header.tsx') },
    { find: '@/components/ui/HeaderMenu', replacement: resolve(root, 'header.tsx') },
    { find: '@/components/app-shell/QuestProgressCard', replacement: resolve(root, 'header.tsx') },
    { find: '@/hooks/useTransportConnectionState', replacement: resolve(root, 'connection.ts') },
    { find: '@/hooks/useWorkspaceTaskCount', replacement: resolve(root, 'connection.ts') },
    { find: '@/atoms/sessions', replacement: resolve(root, 'sessions.ts') },
    { find: /^@craft-agent\/ui$/, replacement: resolve(root, 'ui.ts') },
    { find: '@craft-agent/shared/environment', replacement: resolve(root, 'environment.ts') },
    { find: '@', replacement: resolve(repository, 'apps/electron/src/renderer') },
    { find: 'react', replacement: resolve(repository, 'node_modules/react') },
    { find: 'react-dom', replacement: resolve(repository, 'node_modules/react-dom') },
  ], dedupe: ['react', 'react-dom'],
}, server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } } })
