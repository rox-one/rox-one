import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/**
 * Partition the viewer bundle so the monolith stops being a single chunk.
 *
 * Only the foundation runtime is grouped; everything else is left to Rollup's
 * default code-splitting. A broader grouping is a trap here: the viewer loads
 * Shiki grammars, Mermaid and PDF previews through dynamic `import()`, and
 * folding those modules into a named chunk makes it a *static* dependency of
 * the entry — turning a lazy 10 MB into an eager one.
 *
 * Locale JSON is intentionally not grouped: it is pulled through dynamic
 * `import()` by `@rox/shared/i18n/lazy`, so each language must stay its own
 * on-demand chunk rather than being merged back into one eager bundle.
 */
function manualChunks(id: string): string | undefined {
  const path = id.replace(/\\/g, '/')
  if (!path.includes('node_modules')) return undefined
  if (/node_modules\/(react|react-dom|scheduler)\//.test(path)) return 'vendor-react'
  if (/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(path)) {
    return 'vendor-i18n'
  }
  return undefined
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  // Base path for production - assets go to /s/assets/* to avoid conflict with marketing site
  base: '/s/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      // Ensure all React imports resolve to the hoisted root node_modules
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      // Viewer is browser-only; core identity store pulls node:os via ui deps.
      'node:fs': resolve(__dirname, './src/shims/empty-node.ts'),
      'node:path': resolve(__dirname, './src/shims/empty-node.ts'),
      'node:os': resolve(__dirname, './src/shims/empty-node.ts'),
      'node:crypto': resolve(__dirname, './src/shims/empty-node.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: 'dist',
    emptyDirBeforeWrite: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom'],
  },
  server: {
    port: 5174, // Different from Electron dev server
    open: true,
    proxy: {
      // Proxy API requests to production R2 during local dev
      '/s/api': {
        target: 'https://agents.rox.one',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
