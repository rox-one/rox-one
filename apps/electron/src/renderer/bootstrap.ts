import { Buffer } from 'buffer'
import process from 'process'

const rendererGlobals = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer
  global?: typeof globalThis
  process?: typeof process
}

rendererGlobals.Buffer ??= Buffer
rendererGlobals.global ??= globalThis
rendererGlobals.process ??= process

if (typeof window !== 'undefined' && window.electronAPI) {
  void import('./main')
} else {
  void import('./browser-preview/BrowserPreview').then(({ renderBrowserPreview }) => {
    renderBrowserPreview()
  })
}
