import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

function nodeBuiltinShimPlugin() {
  const stub = resolve(__dirname, '../electron/src/renderer/shims/node-stub.ts')
  const names: Record<string, true> = {
    fs: true, 'fs/promises': true, path: true, os: true, crypto: true, child_process: true,
    url: true, util: true, stream: true, events: true, http: true, https: true,
    net: true, tls: true, zlib: true, buffer: true, assert: true,
    string_decoder: true, readline: true, module: true,
    'node:fs': true, 'node:fs/promises': true, 'node:path': true, 'node:os': true,
    'node:crypto': true, 'node:child_process': true, 'node:url': true, 'node:util': true,
    'node:stream': true, 'node:events': true, 'node:buffer': true, 'node:process': true,
    'node:http': true, 'node:https': true, 'node:net': true,
    'node:tls': true, 'node:zlib': true, 'node:assert': true,
    'node:string_decoder': true, 'node:readline': true, 'node:module': true,
  }
  return {
    name: 'node-builtin-shim',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const clean = id.split('?')[0] || id
      if (Object.hasOwn(names, clean) || Object.hasOwn(names, id)) return stub
      if (clean.startsWith('node:')) return stub
      return null
    },
  }
}

function stubNpmLocksPlugin() {
  const stub = resolve(__dirname, '../electron/src/renderer/shims/npm-locks-stub.ts')
  return {
    name: 'stub-npm-locks',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const clean = (id.split('?')[0] || id).replace(/\\/g, '/')
      if (
        clean === './npm-locks' ||
        clean === '../npm-locks' ||
        clean.endsWith('/npm-locks') ||
        clean.endsWith('/npm-locks.ts') ||
        clean.endsWith('/toolchain/npm-locks')
      ) {
        return stub
      }
      return null
    },
  }
}

/**
 * Resolve @craft-agent/* from this checkout. A shared node_modules symlink
 * otherwise follows workspace links into another worktree's packages.
 */
function worktreeCraftPackagePlugin() {
  const packages: Array<{ name: string; dir: string }> = [
    { name: '@craft-agent/shared', dir: 'shared' },
    { name: '@craft-agent/ui', dir: 'ui' },
    { name: '@craft-agent/core', dir: 'core' },
    { name: '@craft-agent/server-core', dir: 'server-core' },
    { name: '@craft-agent/cloud-runner', dir: 'cloud-runner' },
  ]
  const maps = packages.map(({ name, dir }) => {
    const pkgRoot = resolve(__dirname, `../../packages/${dir}`)
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      exports?: Record<string, string>
    }
    return { name, pkgRoot, exports: pkg.exports ?? {} }
  })

  return {
    name: 'worktree-craft-packages',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const clean = (id.split('?')[0] || id).replace(/\\/g, '/')
      for (const entry of maps) {
        if (clean !== entry.name && !clean.startsWith(`${entry.name}/`)) continue
        const sub = clean === entry.name ? '.' : `.${clean.slice(entry.name.length)}`
        const target = entry.exports[sub]
        if (typeof target !== 'string') return null
        return resolve(entry.pkgRoot, target)
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          'jotai/babel/plugin-debug-label',
          ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
        ],
      },
    }),
    tailwindcss(),
    worktreeCraftPackagePlugin(),
    stubNpmLocksPlugin(),
    nodeBuiltinShimPlugin(),
  ],
  root: resolve(__dirname, 'src'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyDirBeforeWrite: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        login: resolve(__dirname, 'src/login.html'),
      },
      // Suppress warnings for Node.js externalized modules — these are
      // referenced by shared code but only used in server/Electron codepaths.
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return
        warn(warning)
      },
    },
  },
  resolve: {
    alias: {
      // Reuse the Electron renderer's components, hooks, pages, etc.
      '@': resolve(__dirname, '../electron/src/renderer'),
      // Web-specific overrides
      '@webui': resolve(__dirname, 'src'),
      // Config alias (same as Electron)
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      // Force single React copy from root node_modules
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      // Electron-specific modules → empty shims for browser builds
      'electron-log/renderer': resolve(__dirname, 'src/shims/electron-log.ts'),
      'electron-log': resolve(__dirname, 'src/shims/electron-log.ts'),
      '@sentry/electron/renderer': resolve(__dirname, 'src/shims/sentry-electron.ts'),
      '@sentry/electron': resolve(__dirname, 'src/shims/sentry-electron.ts'),
      // Node.js 'ws' library → browser uses native WebSocket
      'ws': resolve(__dirname, 'src/shims/ws.ts'),
      '@anthropic-ai/claude-agent-sdk': resolve(__dirname, '../electron/src/renderer/shims/claude-agent-sdk-stub.ts'),
      'bash-parser': resolve(__dirname, '../electron/src/renderer/shims/bash-parser-stub.ts'),
      tar: resolve(__dirname, '../electron/src/renderer/shims/tar-stub.ts'),
      glob: resolve(__dirname, '../electron/src/renderer/shims/glob-stub.ts'),
      [resolve(__dirname, '../../packages/shared/src/toolchain/npm-locks.ts')]:
        resolve(__dirname, '../electron/src/renderer/shims/npm-locks-stub.ts'),
      // 'open' npm package (Node.js shell utility) — no-op in browser
      'open': resolve(__dirname, 'src/shims/open.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  define: {
    // Flag to detect web UI context in shared code
    'import.meta.env.IS_WEBUI': 'true',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai'],
    exclude: ['@craft-agent/ui', '@craft-agent/shared', '@craft-agent/core'],
    esbuildOptions: {
      supported: { 'top-level-await': true },
      target: 'esnext',
    },
  },
  server: {
    port: 5175,
    open: false,
    host: true,
    // Proxy API + WS to the headless server so the dev bundle on :5175 works
    // end-to-end with HMR. Target port follows CRAFT_RPC_PORT (default 9100).
    // Auto-detects TLS: if the server has CRAFT_RPC_TLS_KEY/CERT set, we proxy
    // over https/wss with secure:false to accept the self-signed dev cert.
    proxy: (() => {
      const port = process.env.CRAFT_RPC_PORT ?? '9100'
      const useTls = Boolean(process.env.CRAFT_RPC_TLS_KEY || process.env.CRAFT_RPC_TLS_CERT)
      const httpProto = useTls ? 'https' : 'http'
      const wsProto = useTls ? 'wss' : 'ws'
      const httpTarget = `${httpProto}://127.0.0.1:${port}`
      const wsTarget = `${wsProto}://127.0.0.1:${port}`
      return {
        '/api': { target: httpTarget, changeOrigin: true, secure: false },
        '/login': { target: httpTarget, changeOrigin: true, secure: false },
        '/ws': { target: wsTarget, ws: true, secure: false },
      }
    })(),
  },
})
