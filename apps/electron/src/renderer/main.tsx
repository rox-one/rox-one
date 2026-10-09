// PERF-01: first import so `renderer:script-start` precedes React/i18n evaluation.
import { markFirstPaintAfterCommit } from './lib/startup-perf'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { initTelemetry, track, type TelemetryHandle } from '@rox/shared/telemetry'
import type { TelemetryBootstrapConfig } from '../shared/types'
import { Provider as JotaiProvider, useAtomValue } from 'jotai'
import App from './App'
import { ThemeProvider } from './context/ThemeContext'
import { ROX_THEME_ID } from '@config/theme'
import { windowWorkspaceIdAtom } from './atoms/sessions'
import { Toaster } from '@/components/ui/sonner'
import { StorageMigrationNotices } from './components/storage/StorageMigrationNotices'
import { setupRendererI18n } from '@rox/shared/i18n/lazy'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import './index.css'
import './chat-chrome-clarity.css'
import './components/app-shell/titlebar-mode-pill.css'
import { installRendererPerfHarness } from './perf/install'
import { startRoxQueryRuntime } from './lib/query/runtime'
import { syncMainProcessLanguage } from './lib/main-language-sync'
import { ShellStoreBridge } from './platform/ShellStoreBridge'
import { RenderProfileMotionConfig } from './lib/render-profile-motion'
import { seedRenderProfile, startRenderProfileSync } from './lib/render-profile-dom'
import { seedEntitiesLinksGate } from './lib/entities-links-sync'
import { subscribeNavigateEvents } from './lib/navigate'
import { drainLearningEventsToTelemetry } from './components/onboarding/learning-curve'

const rendererPerfHarness = installRendererPerfHarness()

// PERF-07: own `data-render-profile` at the root, before React and AppShell,
// so every startup screen (loading, onboarding, reauth, workspace picker)
// renders with the active profile. The snapshot request starts right here.
seedRenderProfile(document.documentElement, window.electronAPI, navigator.userAgent)
const stopRenderProfileSync = startRenderProfileSync(window.electronAPI, document.documentElement)
import.meta.hot?.dispose(stopRenderProfileSync)

// Initialize i18n before any React rendering
// (bootstrap.ts preloads the active locale + fallbacks; others load on switch)
const i18n = setupRendererI18n([LanguageDetector, initReactI18next])
// One-shot bootstrap: ensure the main process's i18n + preferences.json learn
// the language we just restored from localStorage. The main-process IPC handler
// validates the code and persists idempotently, so this is safe to run on every
// renderer startup. Without this push, a freshly-installed (or freshly-upgraded)
// app would still generate titles in English until the user manually re-picks
// the language in Appearance.
const resolvedLanguage = i18n.resolvedLanguage || i18n.language
// Diagnostic: console-log the bootstrap push so it shows up in DevTools,
// alongside the main-process [i18n] startup hydration log. If these two
// diverge, the renderer's localStorage isn't tracking the user's Appearance
// selection.
console.info('[i18n] renderer bootstrap push', {
  resolvedLanguage: resolvedLanguage ?? null,
  localStorageI18nextLng: typeof window !== 'undefined' ? window.localStorage?.getItem('i18nextLng') : null,
})
const disposeMainLanguageSync = syncMainProcessLanguage(i18n, window.electronAPI)
import.meta.hot?.dispose(disposeMainLanguageSync)

// Product analytics — renderer half.
//
// Reuses main's baked endpoints + anonymous distinct_id (bridged over
// `getTelemetryConfig`) so UI events join the same PostHog person as the main
// process. Consent mirrors the «Аналитика продукта» toggle (default ON) and is
// refreshed whenever the gamification profile changes. Inert when endpoints are
// unset. On page teardown the buffered capture is flushed with `sendBeacon`,
// which (unlike `fetch`) survives the renderer being torn down.
// Consent is unknown until the gamification profile resolves, so it starts
// fail-closed (no egress) and flips on once the store confirms it — the
// «Аналитика продукта» default is ON, so this is a sub-second startup window,
// never a stale opt-in for users who turned it off.
let rendererAnalyticsConsent = false
const applyAnalyticsConsent = (consent: unknown): void => {
  if (typeof consent === 'boolean') rendererAnalyticsConsent = consent
}
// `flagsDisabled` is carried alongside the endpoint config by main (not part of
// the published bootstrap type yet), so widen the snapshot rather than the API.
const telemetryBootstrap = (window.electronAPI?.getTelemetryConfig?.() ?? null) as
  | (TelemetryBootstrapConfig & { flagsDisabled?: boolean })
  | null
const rendererTelemetry: TelemetryHandle | null = telemetryBootstrap
  ? initTelemetry({
      ...telemetryBootstrap,
      platform: navigator.platform,
      getConsent: () => rendererAnalyticsConsent,
      sendBeaconImpl: (url, data) =>
        navigator.sendBeacon(url, new Blob([data], { type: 'application/json' })),
    })
  : null
void window.electronAPI?.getGamificationProfile?.()
  .then((profile) => applyAnalyticsConsent(profile?.analyticsConsent))
  .catch(() => { /* store unreachable → stay fail-closed */ })
const offGamificationAnalytics = window.electronAPI?.onGamificationChanged?.((profile) =>
  applyAnalyticsConsent(profile?.analyticsConsent))

// Minimal surface-view tracking: only the home and sessions families are
// instrumented, matched from the route string on `lib/navigate`'s NAVIGATE_EVENT.
// Everything else stays untracked (see the "do not instrument everything" rule).
const SURFACE_BY_ROUTE_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['home', 'home'],
  ['allSessions', 'sessions'],
  ['flagged', 'sessions'],
  ['archived', 'sessions'],
  ['state/', 'sessions'],
  ['label/', 'sessions'],
  ['view/', 'sessions'],
]
let lastSurface: string | null = null
const stopSurfaceTracking = subscribeNavigateEvents((route) => {
  const match = SURFACE_BY_ROUTE_PREFIX.find(([prefix]) => route === prefix || route.startsWith(prefix))
  if (!match || match[1] === lastSurface) return
  lastSurface = match[1]
  track('surface_viewed', { surface: match[1] })
})

// Drain buffered onboarding learning-curve events on a slow cadence and right
// before teardown, so the last events ride the pagehide beacon flush.
const LEARNING_DRAIN_INTERVAL_MS = 30_000
const learningDrainTimer = setInterval(drainLearningEventsToTelemetry, LEARNING_DRAIN_INTERVAL_MS)
const flushRendererTelemetry = (): void => {
  drainLearningEventsToTelemetry()
  rendererTelemetry?.flushWithBeacon()
}
window.addEventListener('pagehide', flushRendererTelemetry)
window.addEventListener('beforeunload', flushRendererTelemetry)
import.meta.hot?.dispose(() => {
  window.removeEventListener('pagehide', flushRendererTelemetry)
  window.removeEventListener('beforeunload', flushRendererTelemetry)
  clearInterval(learningDrainTimer)
  stopSurfaceTracking()
  offGamificationAnalytics?.()
  rendererTelemetry?.dispose()
})

/**
 * Minimal fallback UI shown when the entire React tree crashes.
 */
function CrashFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium">{i18n.t('crash.somethingWentWrong')}</p>
      <p className="text-[13px]">{i18n.t('crash.restartPrompt')}</p>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
      >
        {i18n.t('crash.reload')}
      </button>
    </div>
  )
}

/**
 * Root error boundary: renders CrashFallback when the tree below it throws.
 * Replaces the previous Sentry.ErrorBoundary (integration removed 2026-10-09);
 * the error is logged to the console instead of being shipped to Sentry.
 */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[RootErrorBoundary] renderer crashed:', error, info.componentStack)
  }

  render(): React.ReactNode {
    return this.state.hasError ? <CrashFallback /> : this.props.children
  }
}

/**
 * Root component - loads workspace ID for theme context and renders App
 * App.tsx handles window mode detection internally (main vs tab-content)
 */
function Root() {
  // Shared atom — written by App on init & workspace switch, read here for ThemeProvider
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)

  const app = <App />

  return (
    <ThemeProvider activeWorkspaceId={workspaceId} fixedColorTheme={ROX_THEME_ID}>
      {/* PERF-07: low-power profile also stops motion/react springs. */}
      <RenderProfileMotionConfig>
        {/* W1-07 (#1504): W1-07 gates outside React read this Provider's store. */}
        <ShellStoreBridge />
        {rendererPerfHarness.enabled
          ? <React.Profiler id="rox-root" onRender={rendererPerfHarness.onRender}>{app}</React.Profiler>
          : app}
        <Toaster />
        <StorageMigrationNotices />
      </RenderProfileMotionConfig>
    </ThemeProvider>
  )
}

// entities.links.v1: seed the route gate from main's effective state
// (env override > persisted toggle) BEFORE the first render, so restored
// entity tabs / persisted `entity/…` keys resolve on the first pass.
seedEntitiesLinksGate()

// PERF-09 (#1576): shared surface cache. Restores the last workspace's
// persisted slice from IndexedDB and maps push events to invalidations.
const stopRoxQueryRuntime = startRoxQueryRuntime(window.electronAPI)
import.meta.hot?.dispose(stopRoxQueryRuntime)

// Quick composer window: main loads this same renderer entry with
// `?surface=quick-composer`; render the standalone composer instead of the
// full app shell. Lazy so the normal app boot never pays for it.
const QuickComposerSurface = React.lazy(
  () => import('./features/native-integrations/QuickComposerSurface'),
)
const rendererSurface = new URLSearchParams(window.location.search).get('surface')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <JotaiProvider>
        {rendererSurface === 'quick-composer' ? (
          <ThemeProvider activeWorkspaceId={null} fixedColorTheme={ROX_THEME_ID}>
            <React.Suspense fallback={null}>
              <QuickComposerSurface />
            </React.Suspense>
          </ThemeProvider>
        ) : (
          <Root />
        )}
      </JotaiProvider>
    </RootErrorBoundary>
  </React.StrictMode>
)
markFirstPaintAfterCommit()
