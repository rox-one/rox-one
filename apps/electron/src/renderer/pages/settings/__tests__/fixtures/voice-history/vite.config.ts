import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const root = import.meta.dirname
const repository = resolve(root, '../../../../../../../../..')
const renderer = resolve(repository, 'apps/electron/src/renderer')

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@/components/settings', replacement: resolve(root, 'settings.ts') },
      { find: /^@craft-agent\/ui$/, replacement: resolve(repository, 'packages/ui/src/components/ui/PremiumMenuSelect.tsx') },
      { find: '@rox/shared/environment', replacement: resolve(repository, 'packages/shared/src/environment/versioning.ts') },
      { find: '@', replacement: renderer },
      { find: 'react', replacement: resolve(repository, 'node_modules/react') },
      { find: 'react-dom', replacement: resolve(repository, 'node_modules/react-dom') },
    ],
    dedupe: ['react', 'react-dom'],
  },
  // Parallel agents may edit unrelated renderer sources during acceptance.
  // Freeze the fixture server for each run so those edits cannot reset its API.
  server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } },
})
