import { defineConfig, type Plugin, type Rollup } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync, writeFileSync } from 'fs'
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
 *   The same applies to MarkdownOpenUIBlock (OpenUI + recharts), rendered
 *   through the same lazy wrapper list.
 * - #1675: the markdown barrel still re-exports the entity nodes and the
 *   official (tiptap) markdown adapter, and `@rox/session-tools-core`
 *   re-exports its gray-matter-backed validation module; the renderer consumes
 *   those through barrel imports whose bindings it never uses, so the same
 *   opt-out keeps @tiptap/core + prosemirror, `marked`, `gray-matter` and
 *   js-yaml out of the startup chunks.
 */
const SIDE_EFFECT_FREE_MODULES = [
  /[\\/]packages[\\/]shared[\\/]src[\\/]i18n[\\/](?:registry\.ts|setupI18n\.ts|date-locales\.ts|locales[\\/][^\\/]+\.json)$/,
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]markdown[\\/](?:TiptapMarkdownEditor|MarkdownDatatableBlock|MarkdownSpreadsheetBlock|MarkdownOpenUIBlock|Markdown|CodeBlock|MarkdownImageBlock|MarkdownHtmlBlock|MarkdownDocBlock|MarkdownRoversCardBlock|SourcedStatement|CollapsibleSection|ImageCardStack)\.tsx$/,
  // The diff viewers register a custom element and Shiki themes at module
  // load; marked here so the @rox/ui barrel re-export alone does not pull them
  // (and Shiki) into startup. Wherever they are used, that code still runs.
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]code-viewer[\\/](?:ShikiDiffViewer|UnifiedDiffViewer)\.tsx$/,
  // #1675: reached only through the `@rox/ui` barrel and the lazily loaded
  // Notes editor (TiptapMarkdownEditor.tsx) - one @tiptap/core import drags
  // the eight prosemirror packages, and official-markdown drags @tiptap/markdown
  // + `marked`. Their real consumers keep importing them normally.
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]markdown[\\/]official-markdown\.ts$/,
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]markdown[\\/]extensions[\\/](?:EntityMention|EntityEmbed|entity-input-rules)\.ts$/,
  // #1675: the renderer imports the dependency-free leaf
  // (`@rox/session-tools-core/tool-defs-filtering`) from
  // session-inspector/SessionContextPanel.tsx; this mark keeps the package
  // barrel from dragging gray-matter + js-yaml back into startup for any other
  // barrel consumer.
  /[\\/]packages[\\/]session-tools-core[\\/]src[\\/]validation\.ts$/,
  // WP7: reached only through the `@rox/ui` overlay barrel; the renderer has no
  // eager consumer, yet the barrel alone kept @uiw/react-json-view in startup.
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]overlay[\\/](?:JSONPreviewOverlay|ActivityCardsOverlay|ImagePreviewOverlay|PDFPreviewOverlay|LazyPDFPreviewOverlay|CodePreviewOverlay|DocumentFormattedMarkdownOverlay|GenericOverlay|TerminalPreviewOverlay|DataTableOverlay|MermaidPreviewOverlay|HTMLPreviewOverlay|FullscreenOverlayBase|FullscreenOverlayBaseHeader|PreviewOverlay|AnnotatableMarkdownDocument)\.tsx$/,
  // ChatPage/EditPopover are lazy; boot still imports Spinner/Tooltip from the
  // `@rox/ui` barrel (session list, AppShell). Without this mark, TurnCard +
  // markdown (parse5, micromark, motion) ride that barrel into index.html.
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]chat[\\/](?:TurnCard|UserMessageBubble|SessionViewer|ThinkingCard|TurnCardActionsMenu|MessageHoverDock|AcceptPlanDropdown|CompactAcceptPlanDrawer|InlineExecution)\.tsx$/,
  /[\\/]packages[\\/]ui[\\/]src[\\/]components[\\/]annotations[\\/].+\.tsx$/,
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
  // WP7: chrono-node and react-day-picker are only used by lazy date editors
  // (label-date-editor.tsx and lazy pages), so they are NOT pinned here: a
  // manual chunk would drag them back into the eager vendor-dates chunk.
  [/^(?:date-fns|@date-fns\/.+)$/, 'vendor-dates'],
]

/** date-fns locales the renderer actually loads. Anything else stays out of vendor-dates. */
const DATE_FNS_LOCALE_CHUNKS = new Set([
  'ar', 'de', 'es', 'fr', 'hu', 'ja', 'ko', 'pl', 'ru', 'zh-CN', 'zh-TW',
])

/** Repo root — the directory bun hoists the workspace's dependencies into (`<root>/node_modules`). */
const REPO_ROOT = resolve(__dirname, '../..')

/** `<repo root>/node_modules/` — the hoisted install every workspace package resolves to by default. */
const HOISTED_NODE_MODULES = `${REPO_ROOT.replace(/\\/g, '/')}/node_modules/`

/**
 * A nested install (`packages/canvas-core/node_modules/zod`) is a *different version* from the hoisted
 * copy at the repo root (`node_modules/zod`) — canvas-core pins zod ^3 while the workspace hoists ^4.
 * Chunk rules below key on the package NAME, so without this split both copies share one chunk, and the
 * shared chunk is the one the boot graph already loads: canvas-core's lazy zod v3 rode `vendor-zod` into
 * every `index.html` load (#2129). Nested copies get their own `<name>-nested` chunk and stay reachable
 * only through the module that actually imports them.
 */
function isNestedInstall(posixPath: string): boolean {
  // The commonjs plugin proxies a hoisted CJS file through a `\0`-prefixed virtual id carrying the same
  // absolute path; drop the marker so the proxy is classified like the file it stands for.
  const path = posixPath.startsWith('\0') ? posixPath.slice(1) : posixPath
  return !path.startsWith(HOISTED_NODE_MODULES)
}

function vendorChunk(id: string): string | undefined {
  const posix = id.replace(/\\/g, '/')
  const name = vendorChunkName(posix)
  return name && isNestedInstall(posix) ? `${name}-nested` : name
}

function vendorChunkName(posix: string): string | undefined {
  const dateFnsLocale = /\/node_modules\/date-fns\/locale\/([^/.]+)(?:\.js|\/|$)/.exec(posix)
  if (dateFnsLocale) {
    const loc = dateFnsLocale[1]
    // Shared helpers + the English fallback stay in the eager vendor-dates
    // chunk. Every other UI language is a dynamic `import()` from
    // date-locale-loaders.ts; pinning those files here would merge them back
    // into the startup closure (and collide with i18n JSON prefixes `ru`, `de`, …).
    if (loc === '_lib' || loc === 'en-US') return 'vendor-dates'
    if (DATE_FNS_LOCALE_CHUNKS.has(loc)) return `date-fns-locale-${loc}`
    return 'date-fns-locale-other'
  }
  const pkg = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(posix)?.[1]?.replace('\\', '/')
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

/**
 * WP1 startup-closure report: with ROX_BUNDLE_REPORT=<file>, write every emitted chunk with its static
 * imports, dynamic imports and per-module rendered bytes, so the eager closure of index.html can be
 * attributed module by module (`bun scripts/bench/startup-closure-report.ts`). Off by default.
 */
function bundleReportPlugin(): Plugin {
  return {
    name: 'rox-bundle-report',
    apply: 'build',
    generateBundle(_options, bundle) {
      const out = process.env.ROX_BUNDLE_REPORT
      if (!out) return
      const chunks = Object.values(bundle)
        .filter((output): output is Rollup.OutputChunk => output.type === 'chunk')
        .map(chunk => ({
          fileName: chunk.fileName,
          isEntry: chunk.isEntry,
          isDynamicEntry: chunk.isDynamicEntry,
          imports: chunk.imports,
          dynamicImports: chunk.dynamicImports,
          modules: Object.fromEntries(Object.entries(chunk.modules)
            .map(([id, info]) => [relative(REPO_ROOT, id.split('?')[0]).replace(/\\/g, '/'), info.renderedLength])),
        }))
      const rel = (id: string) => relative(REPO_ROOT, id.split('?')[0]).replace(/\\/g, '/')
      // ROX_BUNDLE_REPORT_GRAPH=1 adds static import edges per module (WHY a module is eager).
      const graph: Record<string, string[]> = {}
      for (const id of process.env.ROX_BUNDLE_REPORT_GRAPH ? this.getModuleIds() : []) {
        const info = this.getModuleInfo(id)
        if (info?.importedIds.length) graph[rel(id)] = info.importedIds.map(rel)
      }
      writeFileSync(resolve(REPO_ROOT, out), JSON.stringify({ chunks, graph }))
    },
  }
}

export default defineConfig(({ command }) => ({
  plugins: [
    react({
      babel: {
        plugins: [
          // Jotai HMR support: caches atom instances in globalThis.jotaiAtomCache
          // so that HMR module re-execution returns stable atom references
          // instead of creating new (empty) atoms that orphan existing data.
          'jotai/babel/plugin-debug-label',
          // Dev/HMR only. This plugin keys the atom cache on `state.filename` —
          // the ABSOLUTE source path — so a `vite build` that ran it would embed
          // local paths into chunk text and make the emitted chunk hash depend on
          // the build directory (breaking reproducible build-manifest checks) and
          // leak the developer's checkout path into shipped bundles. HMR only
          // runs under `serve`, so builds omit it.
          ...(command === 'serve'
            ? ([['jotai/babel/plugin-react-refresh', { customAtomNames: ['atomFamily'] }]] as const)
            : []),
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
    bundleReportPlugin(),
  ],
  root: resolve(__dirname, 'src/renderer'),
  cacheDir: resolve(__dirname, '.vite-worktree'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    // Emit `.vite/manifest.json` next to the chunks. It is the build's own statement of every
    // chunk's real name (`name`) and emitted file (`file`), which is what scripts/check-bundle-size.ts
    // reads to name a budget prefix. Without it that gate falls back to stripping a `-<8-char hash>`
    // suffix — a guess about Rollup's naming that silently mis-keys (and so un-budgets) a chunk the
    // moment the hash length or separator changes. Nothing else consumes this file, and it is not a
    // measured asset (the gate only weighs emitted *.js/*.css).
    manifest: true,
    // Production dist must not ship source maps (S9-11: 68 MB of *.map).
    // `scripts/boot-manifest.ts` still derives the boot closure from the sibling
    // maps, so the CI bundle-size job and local manifest regeneration opt back in
    // with ROX_RENDERER_SOURCEMAP=1 — the packaged app never sets it.
    sourcemap: process.env.ROX_RENDERER_SOURCEMAP === '1',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        // Keep `playground.html` as a build input even though it is not part of
        // the shipped product: Rollup derives chunk granularity from the whole
        // entry set. Dropping it collapses the app's ~50 chunks into one ~2.6 MB
        // `main` chunk (measured: `main` prefix 2 631 634 B vs a 347 295 B
        // budget, index closure 19 files instead of 51). Excluding the built
        // playground page from the distribution is a separate, chunking-aware
        // change; `vite dev` / playground-dev.ts serve it from disk regardless.
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
}))
