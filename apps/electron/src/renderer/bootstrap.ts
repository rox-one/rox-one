import { Buffer } from 'buffer'
import process from 'process'
import { migrateConationFlagsDefaultOff } from './lib/migrate-conation-flags-default-off'
import { migrateSidePanelDefaults } from './lib/shell-layout-preferences'
import { installStaleChunkReload } from './lib/stale-chunk-reload'
import { preloadRendererLocales } from '@rox/shared/i18n/lazy'

const rendererGlobals = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: typeof globalThis
  process?: typeof process
}

rendererGlobals.Buffer ??= Buffer
rendererGlobals.global ??= globalThis
rendererGlobals.process ??= process

// b1.2: install the one-shot stale-chunk recovery before the first dynamic
// import. A build that outlived its chunk filenames (post-update launch) would
// otherwise leave the loading shell spinning forever; this reloads the window
// exactly once per session, so a genuinely offline renderer does not loop.
installStaleChunkReload()

// One-shot: sticky craft-feature-workbench-conation-*=true must not keep
// Fund/Board LIVE ON after atom defaults went false. Must run before
// dynamic import('./main') so jotai getOnInit sees cleared storage.
migrateConationFlagsDefaultOff()

// One-shot layout v2: equal left/right side-panel widths and an expanded
// activity rail. Same constraint: before jotai getOnInit reads storage.
try {
  migrateSidePanelDefaults()
} catch (err) {
  console.warn('[layout] side panel defaults migration failed', err)
}

if (typeof window !== 'undefined' && window.electronAPI) {
  // PERF-04: only the active locale and its fallbacks are fetched (never
  // rejects), so main.tsx can initialize i18n synchronously before rendering.
  // main's chunk graph is already downloading in parallel: the build emits
  // <link rel="modulepreload"> for it (vite.config.ts), which fetches and
  // compiles without evaluating, so i18n still initialises first.
  void preloadRendererLocales().then(() => { void import('./main') })
} else {
  void import('./browser-preview/BrowserPreview').then(({ renderBrowserPreview }) => {
    renderBrowserPreview()
  })
}
