/**
 * Web UI App — thin wrapper that:
 * 1. Fetches WS config from the server
 * 2. Creates the web API adapter + sets window.electronAPI
 * 3. Delegates to the Electron renderer's App component
 *
 * Mobile responsiveness is handled by container queries and isAutoCompact
 * in the shared renderer components — no webui-specific layout hacks needed.
 */

import React, { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { createWebApi } from './adapter/web-api'
import type { AuthenticatedWebTransportBootstrap } from '../../electron/src/renderer/lib/authenticated-web-bootstrap'
import { initializeAuthenticatedWebTransport } from './adapter/transport-bootstrap'
import { WEBUI_REQUIRES_CONATION_FLAG } from './rox2-webui-surface'
import { WebModesLanding } from './web-modes-landing'
import { CloudVmSurface } from './cloud-vm-surface'
import { isModesLandingEnabled, isWebSession, parseWebEntryMode, probeCloudVmState, type WebEntryModeId } from './web-modes'
import { navigate, routes } from '@/lib/navigate'
import { ThemeProvider } from '@/context/ThemeContext'
import { ROX_THEME_ID } from '@config/theme'
import { windowWorkspaceIdAtom } from '@/atoms/sessions'
import { Toaster } from '@/components/ui/sonner'

export { WEBUI_REQUIRES_CONATION_FLAG, WEBUI_SURFACE_ID, webuiSurfaceResult } from './rox2-webui-surface'

// Lazy-load the Electron App after window.electronAPI is set up.
// This prevents any Electron component from accessing window.electronAPI
// before the web adapter is ready.
const ElectronApp = lazy(() => import('@/App'))

// ThemeProvider reads the API once on mount. Mount it only after authenticated
// transport is ready, so initial preset and preference reads use the real API.
function ReadyRenderer({ bootstrap }: { bootstrap: AuthenticatedWebTransportBootstrap }) {
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  return (
    <ThemeProvider activeWorkspaceId={workspaceId ?? bootstrap.workspaceId} fixedColorTheme={ROX_THEME_ID}>
      <Suspense fallback={<LoadingScreen />}>
        <ElectronApp webTransportBootstrap={bootstrap} />
      </Suspense>
      <Toaster />
    </ThemeProvider>
  )
}

type Phase = 'loading' | 'error' | 'ready'

function LoadingScreen() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <div className="animate-spin w-6 h-6 border-2 border-current border-t-transparent rounded-full" />
      <p className="text-[13px]">{t("webui.connectingToServer")}</p>
    </div>
  )
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center h-screen font-sans text-foreground/50 gap-3">
      <p className="text-base font-medium text-destructive">{t("webui.connectionFailed")}</p>
      <p className="text-[13px] max-w-md text-center">{message}</p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onRetry}
          className="px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
        >
          {t("common.retry")}
        </button>
        <button
          onClick={() => {
            fetch('/api/auth/logout', { method: 'POST' }).then(() => {
              window.location.href = '/login'
            })
          }}
          className="px-4 py-1.5 rounded-md bg-background shadow-minimal text-[13px] text-foreground/70 cursor-pointer"
        >
          {t("webui.logOut")}
        </button>
      </div>
    </div>
  )
}

export default function App() {
  if (WEBUI_REQUIRES_CONATION_FLAG) {
    throw new Error('Web UI is native and must not require Conation')
  }
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [bootstrap, setBootstrap] = useState<AuthenticatedWebTransportBootstrap | null>(null)
  // null = not yet confirmed. The two-mode landing is offered only to a
  // confirmed web session; an unconfirmed session keeps the desktop-like flow.
  const [webSession, setWebSession] = useState<boolean | null>(null)
  // The operator's landing switch (`ROX_WEBUI_MODES_LANDING` via /api/config).
  // null = not read yet; the flag defaults to enabled when the config is
  // unreadable (see isModesLandingEnabled).
  const [modesLanding, setModesLanding] = useState<boolean | null>(null)
  // A validated `?mode=` deep link skips the landing and enters that mode. An
  // invalid or absent value is ignored (undefined). `chat` is known up front, so
  // it enters synchronously; `cloud-vm` needs the honest availability gate and
  // is resolved by the effect below.
  const [deepLinkMode] = useState(() => parseWebEntryMode(new URLSearchParams(window.location.search).get('mode')))
  // Chosen entry mode (null = landing not yet answered) + whether the cloud-VM
  // surface overlay is open above the mounted renderer. `chat` shows the shared
  // renderer; `cloud-vm` opens CloudVmSurface above it. `?mode=chat` seeds the
  // mode so the deep link enters the chat surface without the landing.
  const [enteredMode, setEnteredMode] = useState<WebEntryModeId | null>(deepLinkMode === 'chat' ? 'chat' : null)
  const [cloudVmOpen, setCloudVmOpen] = useState(false)
  // A `?sessionId=` deep link («Продолжить в веб») goes straight to its session.
  const [directSessionId] = useState(() => new URLSearchParams(window.location.search).get('sessionId'))
  // «Вошли» = a mode was chosen on the landing (null = landing still shown).
  const entered = enteredMode !== null
  // A `?mode=cloud-vm` deep link must pass the same honest availability gate as
  // the landing tile: it enters only once the host reports a usable cloud-VM
  // provider, and otherwise falls back to the landing state text.
  const [cloudLinkChecking, setCloudLinkChecking] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let ownedClient: ReturnType<typeof createWebApi>['client'] | undefined
    let unsubscribe: (() => void) | undefined
    setPhase('loading')
    setError('')
    setBootstrap(null)
    setWebSession(null)
    setModesLanding(null)

    void initializeAuthenticatedWebTransport({
      fetch: window.fetch.bind(window),
      requestedWorkspace: new URLSearchParams(window.location.search).get('workspace'),
      signal: controller.signal,
      createAdapter: options => {
        const adapter = createWebApi(options)
        ownedClient = adapter.client
        return adapter
      },
    }).then(({ api, client, bootstrap: verified }) => {
      if (controller.signal.aborted) return
      // Only a server-acknowledged connection may mount the shared renderer.
      window.electronAPI = api
      setBootstrap(verified)
      setPhase('ready')
      // Confirm the web session (per-user Rox ID or the legacy password) before
      // offering the two-mode landing. `/api/auth/me` always reports `authMode`;
      // a rejected read keeps `webSession` false and the desktop-like flow.
      void fetch('/api/auth/me', { credentials: 'same-origin' })
        .then(res => (res.ok ? res.json() : null))
        .then(payload => {
          if (!controller.signal.aborted) setWebSession(isWebSession(payload))
        })
        .catch(() => {
          if (!controller.signal.aborted) setWebSession(false)
        })
      // The operator's landing switch lives in `/api/config`. An unreadable or
      // non-object payload keeps the documented default (landing enabled) — see
      // isModesLandingEnabled — so a config hiccup never changes the entry flow.
      void fetch('/api/config', { credentials: 'same-origin' })
        .then(res => (res.ok ? res.json() : null))
        .then(payload => {
          if (!controller.signal.aborted) setModesLanding(isModesLandingEnabled(payload))
        })
        .catch(() => {
          if (!controller.signal.aborted) setModesLanding(true)
        })
      unsubscribe = client.onConnectionStateChanged(state => {
        if (state.status === 'connected' && client.getAcknowledgedWorkspaceId() !== verified.workspaceId) {
          setError('Server acknowledged workspace does not match the configured workspace')
          setPhase('error')
          client.destroy()
        }
      })
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return
      if (err && typeof err === 'object' && 'status' in err && err.status === 401) {
        window.location.href = '/login'
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    })

    return () => {
      controller.abort()
      unsubscribe?.()
      ownedClient?.destroy()
    }
  }, [attempt])

  // `?mode=cloud-vm` deep link: enter only when the host actually reports a
  // usable cloud-VM provider. Otherwise the landing (with the honest reason from
  // web-modes.ts) takes over — never a dead entry into a mode that is not there.
  useEffect(() => {
    if (deepLinkMode !== 'cloud-vm' || entered) return
    if (!webSession || directSessionId || modesLanding !== true) return
    let cancelled = false
    setCloudLinkChecking(true)
    void probeCloudVmState(window.electronAPI).then(state => {
      if (cancelled) return
      setCloudLinkChecking(false)
      if (state.status === 'available') {
        setEnteredMode('cloud-vm')
        setCloudVmOpen(true)
      }
    })
    return () => {
      cancelled = true
      setCloudLinkChecking(false)
    }
  }, [deepLinkMode, entered, webSession, directSessionId, modesLanding])

  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'error') return <ErrorScreen message={error} onRetry={() => setAttempt(value => value + 1)} />
  if (!bootstrap || webSession === null) return <LoadingScreen />
  // The two-mode landing is strictly a web-session entry; direct session deep
  // links and non-web (unconfirmed) sessions mount the renderer as before. A
  // valid `?mode=` deep link, the operator's `modesLanding: false` switch and an
  // already-chosen mode all skip the landing. `?sessionId=` always wins.
  if (webSession && !entered && !directSessionId) {
    // Wait for the operator switch before deciding, and for an in-flight
    // cloud-VM deep-link probe so we never flash the landing before entering.
    if (modesLanding === null || cloudLinkChecking) return <LoadingScreen />
    if (modesLanding) return (
      <WebModesLanding host={window.electronAPI} onEnter={(mode) => {
        setEnteredMode(mode)
        setCloudVmOpen(mode === 'cloud-vm')
      }} />
    )
  }

  // The renderer always mounts (its RPC must be live), with the cloud-VM
  // surface as a fixed overlay when that mode was chosen. «Перейти в чат»
  // simply closes the overlay; «Открыть» navigates the renderer underneath.
  // The overlay is a real modal: the background renderer is inert/hidden from
  // both keyboard and screen readers while it is open.
  const overlayTimers = useRef<number[]>([])
  const clearOverlayTimers = () => {
    for (const id of overlayTimers.current) window.clearTimeout(id)
    overlayTimers.current = []
  }
  useEffect(() => clearOverlayTimers, [])

  return (
    <>
      <div {...(cloudVmOpen ? { inert: '' as unknown as boolean, 'aria-hidden': true } : {})}>
        <ReadyRenderer bootstrap={bootstrap} />
      </div>
      {cloudVmOpen && (
        <div
          className="fixed inset-0 z-50 overflow-auto bg-background"
          data-cloud-vm-surface-overlay="true"
          role="dialog"
          aria-modal="true"
        >
          <CloudVmSurface
            host={window.electronAPI}
            onOpenRun={(id) => {
              // The shared renderer mounts lazily behind this overlay, so a
              // single dispatch can beat NavigationContext's subscription and
              // be dropped. Re-dispatch while the overlay still owns the
              // screen (the user cannot navigate elsewhere underneath it) and
              // close only after the last attempt. Any previous run-open is
              // cancelled so a second click cannot interleave two routes.
              clearOverlayTimers()
              const route = routes.view.cloudRun(id)
              for (const delay of [0, 700, 1600]) {
                overlayTimers.current.push(window.setTimeout(() => navigate(route), delay))
              }
              overlayTimers.current.push(window.setTimeout(() => setCloudVmOpen(false), 1900))
            }}
            onGoToChat={() => {
              // The user explicitly leaves the cloud surface: cancel any queued
              // navigate so a previous «Открыть» cannot pull the chat back out.
              clearOverlayTimers()
              setCloudVmOpen(false)
            }}
          />
        </div>
      )}
    </>
  )
}
