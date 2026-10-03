import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider as JotaiProvider } from 'jotai'
import App from './App'
import { setupI18n } from '@rox/shared/i18n'
import { initReactI18next } from 'react-i18next'
import { useTranslation } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import './index.css'

// Initialize i18n before any React rendering
setupI18n([LanguageDetector, initReactI18next])

function CrashFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{t("auth.somethingWentWrong")}</p>
      <p className="text-[13px]">{t("errors.pleaseReload")}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <JotaiProvider>
        <App />
      </JotaiProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)
