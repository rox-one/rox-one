import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

// NOTE: Source map upload to Sentry is intentionally disabled.
// To re-enable, uncomment the sentryVitePlugin below and add SENTRY_AUTH_TOKEN,
// SENTRY_ORG, SENTRY_PROJECT to CI secrets. See CLAUDE.md "Sentry Error Tracking" section.
// import { sentryVitePlugin } from '@sentry/vite-plugin'

/**
 * Shared modules still expose some server-only imports to the renderer bundle.
 * Vite needs concrete named exports to build those modules; runtime renderer
 * work remains behind the preload API and must not use these stand-ins.
 */
function stubNpmLocksPlugin() {
  const stub = resolve(__dirname, 'src/renderer/shims/npm-locks-stub.ts')
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

function worktreeCraftPackagePlugin() {
  const packages: Array<{ name: string; dir: string }> = [
    { name: '@craft-agent/shared', dir: 'shared' },
    { name: '@craft-agent/ui', dir: 'ui' },
    { name: '@craft-agent/core', dir: 'core' },
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

function nodeBuiltinStubPlugin() {
  const stub = resolve(__dirname, 'src/renderer/shims/node-stub.ts')
  const names: Record<string, true> = {
    'fs': true, 'fs/promises': true, 'path': true, 'os': true, 'crypto': true,
    'child_process': true, 'url': true, 'util': true, 'stream': true, 'events': true,
    'module': true, 'assert': true, 'worker_threads': true, 'http': true, 'https': true,
    'net': true, 'tls': true, 'dns': true, 'zlib': true, 'querystring': true,
    'string_decoder': true, 'readline': true, 'tty': true, 'constants': true,
    'vm': true, 'perf_hooks': true, 'async_hooks': true, 'timers': true,
    'node:fs': true, 'node:fs/promises': true, 'node:path': true, 'node:os': true,
    'node:crypto': true, 'node:child_process': true, 'node:url': true, 'node:util': true,
    'node:stream': true, 'node:events': true, 'node:buffer': true, 'node:module': true,
    'node:assert': true, 'node:process': true, 'node:worker_threads': true,
    'node:http': true, 'node:https': true, 'node:net': true, 'node:tls': true,
    'node:dns': true, 'node:zlib': true,
  }

  return {
    name: 'node-builtin-stub',
    enforce: 'pre' as const,
    resolveId(id: string) {
      const clean = id.split('?')[0] || id
      if (Object.hasOwn(names, clean) || Object.hasOwn(names, id)) return stub
      if (clean.startsWith('node:')) return stub

      const base = clean.replace(/^\0/, '').replace(/^.*node_modules\//, '')
      return Object.hasOwn(names, base) ? stub : null
    },
  }
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [
          // Jotai HMR support: caches atom instances in globalThis.jotaiAtomCache
          // so that HMR module re-execution returns stable atom references
          // instead of creating new (empty) atoms that orphan existing data.
          'jotai/babel/plugin-debug-label',
          ['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }],
        ],
      },
    }),
    tailwindcss(),
    stubNpmLocksPlugin(),
    worktreeCraftPackagePlugin(),
    nodeBuiltinStubPlugin(),
    // Sentry source map upload — intentionally disabled. See CLAUDE.md for re-enabling instructions.
    // sentryVitePlugin({
    //   org: process.env.SENTRY_ORG,
    //   project: process.env.SENTRY_PROJECT,
    //   authToken: process.env.SENTRY_AUTH_TOKEN,
    //   disable: !process.env.SENTRY_AUTH_TOKEN,
    //   sourcemaps: {
    //     filesToDeleteAfterUpload: ['**/*.map'],
    //   },
    // }),
  ],
  root: resolve(__dirname, 'src/renderer'),
  cacheDir: resolve(__dirname, '.vite-worktree'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyDirBeforeWrite: true,
    sourcemap: true,  // Source maps generated for debugging. Not uploaded to Sentry (see CLAUDE.md).
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
        'browser-toolbar': resolve(__dirname, 'src/renderer/browser-toolbar.html'),
        'browser-empty-state': resolve(__dirname, 'src/renderer/browser-empty-state.html'),
        'voice-overlay': resolve(__dirname, 'src/renderer/voice-overlay.html'),
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer'),
      '@config': resolve(__dirname, '../../packages/shared/src/config'),
      'react': resolve(__dirname, '../../node_modules/react'),
      'react-dom': resolve(__dirname, '../../node_modules/react-dom'),
      '@anthropic-ai/claude-agent-sdk': resolve(__dirname, 'src/renderer/shims/claude-agent-sdk-stub.ts'),
      'bash-parser': resolve(__dirname, 'src/renderer/shims/bash-parser-stub.ts'),
      tar: resolve(__dirname, 'src/renderer/shims/tar-stub.ts'),
      glob: resolve(__dirname, 'src/renderer/shims/glob-stub.ts'),
      [resolve(__dirname, '../../packages/shared/src/toolchain/npm-locks.ts')]:
        resolve(__dirname, 'src/renderer/shims/npm-locks-stub.ts'),
    },
    dedupe: ['react', 'react-dom']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'jotai', 'pdfjs-dist'],
    exclude: ['@craft-agent/ui', '@craft-agent/shared', '@craft-agent/core', '@anthropic-ai/claude-agent-sdk', 'tar', 'glob'],
    esbuildOptions: {
      supported: { 'top-level-await': true },
      target: 'esnext',
      define: { global: 'globalThis' },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    open: false,
  },
  define: {
    global: 'globalThis',
  },
})
