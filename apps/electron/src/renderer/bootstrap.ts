import { Buffer } from 'buffer'
import process from 'process'
import { migrateConationFlagsDefaultOff } from './lib/migrate-conation-flags-default-off'
import { migrateSidePanelDefaults } from './lib/shell-layout-preferences'

const rendererGlobals = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: typeof globalThis
  process?: typeof process
}

rendererGlobals.Buffer ??= Buffer
rendererGlobals.global ??= globalThis
rendererGlobals.process ??= process

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
  void import('./main')
} else {
  void import('./browser-preview/BrowserPreview').then(({ renderBrowserPreview }) => {
    renderBrowserPreview()
  })
}
