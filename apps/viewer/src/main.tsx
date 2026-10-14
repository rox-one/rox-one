import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { preloadRendererLocales, setupRendererI18n } from '@rox/shared/i18n/lazy'
import { initReactI18next } from 'react-i18next'
import './index.css'

// Initialize i18n before any React rendering, loading only the active language
// plus its fallback chain (Russian, then English). The eager `setupI18n()` this
// replaces statically bundled all twelve locales (~9 MB) into the entry chunk;
// the lazy loaders keep each language in its own on-demand chunk.
async function bootstrap(): Promise<void> {
  await preloadRendererLocales()
  setupRendererI18n([initReactI18next])

  const container = document.getElementById('root')
  if (!container) throw new Error('Root element not found')

  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
