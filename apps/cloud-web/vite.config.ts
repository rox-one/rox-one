import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

/** Resolve a path relative to this config, so the build works from any cwd. */
const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))

/**
 * Rox Cloud web: one SolidJS application for the site, the console and the
 * staff panel. The build lands in the API's public directory and is served by
 * `apps/cloud-api/src/spa.ts` from the same origin as `/v1`, so every client
 * call is a relative URL and the key never leaves `sessionStorage`.
 */
export default defineConfig({
  base: '/',
  plugins: [solid()],
  resolve: {
    alias: {
      '@': here('./src'),
      '@pricing': here('../../packages/cloud-pricing/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
    fs: {
      // The pricing package lives outside the app directory.
      allow: [here('../..')],
    },
  },
  build: {
    outDir: here('../cloud-api/public/app'),
    emptyOutDir: true,
    assetsDir: 'assets',
    target: 'es2022',
    sourcemap: false,
  },
})
