import React, { useCallback } from 'react'
import { useTranslation, initReactI18next } from 'react-i18next'
import ReactDOM from 'react-dom/client'
import { initRendererI18n } from '@rox/shared/i18n/lazy'
import LanguageDetector from 'i18next-browser-languagedetector'
import { BrowserEmptyStateCard } from '@rox/ui'
import { routes } from '../shared/routes'
import { EMPTY_STATE_PROMPT_SAMPLES } from './components/browser/empty-state-prompts'
import './index.css'

// Only the active locale (+ fallbacks) is loaded; rendering waits for it below.
const i18nReady = initRendererI18n([LanguageDetector, initReactI18next])

function BrowserEmptyStateApp() {
  const { t } = useTranslation()
  const handlePromptSelect = useCallback(async (fullPrompt: string) => {
    const route = routes.action.newSession({ input: fullPrompt, send: true })
    const token = String(Date.now())

    try {
      if (window.electronAPI?.browserPane?.emptyStateLaunch) {
        await window.electronAPI.browserPane.emptyStateLaunch({ route, token })
        return
      }
    } catch {
      // Fallback to hash-signaling below if IPC route fails for any reason.
    }

    const launchParams = new URLSearchParams({ route, ts: token })
    window.location.hash = `launch=${launchParams.toString()}`
  }, [])

  return (
    <div className="h-screen w-screen bg-foreground-2 overflow-hidden">
      <div className="h-full w-full bg-background overflow-auto">
        <BrowserEmptyStateCard
          title={t("browser.readyTitle")}
          description={t("browser.readyDescription")}
          prompts={EMPTY_STATE_PROMPT_SAMPLES}
          showExamplePrompts={true}
          showSafetyHint={true}
          onPromptSelect={(sample) => handlePromptSelect(sample.full)}
        />
      </div>
    </div>
  )
}

void i18nReady.then(() => ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserEmptyStateApp />
  </React.StrictMode>,
))
