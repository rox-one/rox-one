import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import App from './App'
import { preloadRendererLocales, setupRendererI18n } from '@rox/shared/i18n/lazy'
import { initReactI18next } from 'react-i18next'
import { useTranslation } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import './index.css'

// Initialize i18n before any React rendering, loading only the active language
// plus its fallback chain (Russian, then English) first. The eager `setupI18n()`
// this replaces statically bundled all twelve locales (~9 MB) into the entry
// chunk; the lazy loaders keep each language in its own on-demand chunk so first
// paint does not wait on it.
async function bootstrap(): Promise<void> {
  await preloadRendererLocales()
  setupRendererI18n([LanguageDetector, initReactI18next])

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <JotaiProvider>
          <App />
        </JotaiProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

function CrashFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{t("auth.somethingWentWrong")}</p>
      <p className="text-base">{t("errors.pleaseReload")}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-base text-foreground/70 cursor-pointer"
      >
        {t("common.reload")}
      </button>
    </div>
  )
}

function ErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense fallback={<CrashFallback />}>
      {children}
    </React.Suspense>
  )
}

void bootstrap()
