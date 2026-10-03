import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../../..')
export default defineConfig({ root, cacheDir: resolve(repository, 'apps/electron/.vite-worktree/feed-caller-fixture'), plugins: [react(), tailwindcss()], resolve: {
  alias: [
    { find: '@/context/AppShellContext', replacement: resolve(root, 'context.tsx') },
    ...['@/atoms/sessions', '@/components/team/team-store', '@/components/team/use-team-roster', '@/hooks/useAutomations'].map(find => ({ find, replacement: resolve(root, 'stubs.ts') })),
    { find: '@', replacement: resolve(repository, 'apps/electron/src/renderer') },
    { find: 'react', replacement: resolve(repository, 'node_modules/react') },
    { find: 'react-dom', replacement: resolve(repository, 'node_modules/react-dom') },
  ], dedupe: ['react', 'react-dom'],
}, server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } } })
