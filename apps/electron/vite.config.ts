import { defineConfig, type Plugin, type Rollup } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'fs'
import { join, posix, relative, resolve } from 'path'

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
    { name: '@rox/shared', dir: 'shared' },
    { name: '@rox/ui', dir: 'ui' },
    { name: '@rox/core', dir: 'core' },
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

/**
 * Modules re-exported by package barrels that the startup graph imports but
 * whose exports only lazy surfaces use. None has top-level side effects (CSS
 * they import travels with the chunk that ends up using them), so mark them
 * side-effect free and let Rollup keep them out of the startup chunks:
 * - `@rox/shared/i18n` still re-exports the eager `registry.ts` (static import
 *   of every locale JSON) and `setupI18n.ts` for the main process and tests;
 *   the renderer loads locales on demand through `@rox/shared/i18n/lazy`.
 * - `@rox/ui` re-exports `TiptapMarkdownEditor` (tiptap, KaTeX, editor CSS),
 *   used only by the lazily loaded Notes page, and the datatable/spreadsheet
 *   blocks, which Markdown renders through lazy wrappers (lazy-blocks.tsx).
 */
const SIDE_EFFECT_FREE_MODULES = [
  /[\\/]packages[\\/]shared[\\/]src[\\/]i18n[\\/](?:registry\.ts|setupI18n\.ts|locales[\\/][^\\/]+\.json)$/,
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]markdown[\\/](?:TiptapMarkdownEditor|MarkdownDatatableBlock|MarkdownSpreadsheetBlock)\.tsx$/,
  // The diff viewers register a custom element and Shiki themes at module
  // load; marked here so the @rox/ui barrel re-export alone does not pull them
  // (and Shiki) into startup. Wherever they are used, that code still runs.
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]code-viewer[\\/](?:ShikiDiffViewer|UnifiedDiffViewer)\.tsx$/,
]

/**
 * Vendor chunks for large packages the main window loads at startup. Keeps
 * the shared startup chunk under ~2.5 MB without moving lazily used code
 * forward: every package listed here is already in the startup graph, and
 * none is used by the small browser-toolbar / empty-state / voice-overlay
 * entries except React, which all entries load anyway. lucide-react is left
 * to Rollup on purpose: as one chunk it would add ~0.9 MB to those entries.
 */
const VENDOR_CHUNKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^(?:react|react-dom|scheduler)$/, 'vendor-react'],
  [/^(?:zod)$/, 'vendor-zod'],
  [/^(?:date-fns|react-day-picker|chrono-node|@date-fns\/.+)$/, 'vendor-dates'],
]

function vendorChunk(id: string): string | undefined {
  const pkg = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id)?.[1]?.replace('\\', '/')
  if (!pkg) return undefined
  return VENDOR_CHUNKS.find(([pattern]) => pattern.test(pkg))?.[1]
}

function sideEffectFreeModulesPlugin(): Plugin {
  return {
    name: 'rox-side-effect-free-modules',
    enforce: 'post',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!SIDE_EFFECT_FREE_MODULES.some(pattern => pattern.test(file))) return null
      // Code is unchanged; `map: null` keeps the existing source map.
      return { code, map: null, moduleSideEffects: false }
    },
  }
}

/**
 * PERF-04: bootstrap.ts loads the active locale chunks before it runs
 * `import('./main')`, so i18n is initialised before main.tsx renders. Without
 * help the browser would only start fetching the ~5 MB main chunk graph after
 * the locales arrive. Emit <link rel="modulepreload"> (fetch + compile, no
 * evaluation) for main's static chunk closure, plus a style preload for its
 * CSS, so both downloads run in parallel. Evaluation order is unchanged.
 */
function modulePreloadMainChunkPlugin(): Plugin {
  const toPosix = (path: string) => path.replace(/\\/g, '/')
  return {
    name: 'rox-modulepreload-main-chunk',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle || !toPosix(ctx.filename).endsWith('/src/renderer/index.html')) return
        const chunks = new Map(
          Object.values(ctx.bundle)
            .filter((output): output is Rollup.OutputChunk => output.type === 'chunk')
            .map(chunk => [chunk.fileName, chunk]),
        )
        // Not facadeModuleId: Rollup leaves it unset for this dynamic entry.
        const main = [...chunks.values()].find(chunk =>
          chunk.isDynamicEntry && chunk.moduleIds.some(id => toPosix(id).endsWith('/src/renderer/main.tsx')))
        if (!main) return
        const files = new Set<string>()
        const css = new Set<string>()
        const stack = [main.fileName]
        while (stack.length) {
          const file = stack.pop()!
          const chunk = chunks.get(file)
          if (!chunk || files.has(file)) continue
          files.add(file)
          for (const cssFile of chunk.viteMetadata?.importedCss ?? []) css.add(cssFile)
          stack.push(...chunk.imports)
        }
        const htmlDir = posix.dirname(toPosix(relative(resolve(__dirname, 'src/renderer'), ctx.filename)))
        const href = (file: string) => `./${posix.relative(htmlDir, file)}`
        const present = (file: string) => html.includes(posix.relative(htmlDir, file))
        return [
          ...[...files].filter(file => !present(file)).map(file => ({
            tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: href(file) }, injectTo: 'head' as const,
          })),
          ...[...css].filter(file => !present(file)).map(file => ({
            tag: 'link', attrs: { rel: 'preload', as: 'style', crossorigin: true, href: href(file) }, injectTo: 'head' as const,
          })),
        ]
      },
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
    // Tailwind's Lightning CSS pass collapses the standard + WebKit
    // backdrop-filter pair to WebKit alone. Chromium ignores that property.
    // Let Vite's CSS minifier preserve both declarations for shipped clients.
    tailwindcss({ optimize: false }),
    stubNpmLocksPlugin(),
    worktreeCraftPackagePlugin(),
    nodeBuiltinStubPlugin(),
    sideEffectFreeModulesPlugin(),
    modulePreloadMainChunkPlugin(),
  ],
  root: resolve(__dirname, 'src/renderer'),
  cacheDir: resolve(__dirname, '.vite-worktree'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,  // Source maps generated for debugging.
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        playground: resolve(__dirname, 'src/renderer/playground.html'),
        'browser-toolbar': resolve(__dirname, 'src/renderer/browser-toolbar.html'),
        'browser-empty-state': resolve(__dirname, 'src/renderer/browser-empty-state.html'),
        'voice-overlay': resolve(__dirname, 'src/renderer/voice-overlay.html'),
      },
      output: {
        manualChunks: vendorChunk,
      },
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
    exclude: ['@rox/ui', '@rox/shared', '@rox/core', '@anthropic-ai/claude-agent-sdk', 'tar', 'glob'],
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
