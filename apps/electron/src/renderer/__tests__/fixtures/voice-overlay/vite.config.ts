import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
const root = import.meta.dirname
const repository = resolve(root, '../../../../../../..')
export default defineConfig({ root, plugins: [react()], resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', strictPort: true, hmr: false, watch: null, fs: { allow: [repository] } } })
