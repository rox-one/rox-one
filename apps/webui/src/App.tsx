/**
 * Web UI App — thin wrapper that:
 * 1. Fetches WS config from the server
 * 2. Creates the web API adapter + sets window.electronAPI
 * 3. Delegates to the Electron renderer's App component
 *
 * Mobile responsiveness is handled by container queries and isAutoCompact
 * in the shared renderer components — no webui-specific layout hacks needed.
 */

import React, { useState, useEffect, lazy, Suspense } from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { createWebApi } from './adapter/web-api'
import type { AuthenticatedWebTransportBootstrap } from '../../electron/src/renderer/lib/authenticated-web-bootstrap'
import { initializeAuthenticatedWebTransport } from './adapter/transport-bootstrap'
import { WEBUI_REQUIRES_CONATION_FLAG } from './rox2-webui-surface'
import { ThemeProvider } from '@/context/ThemeContext'
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
    <ThemeProvider activeWorkspaceId={workspaceId ?? bootstrap.workspaceId}>
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

  useEffect(() => {
    const controller = new AbortController()
    let ownedClient: ReturnType<typeof createWebApi>['client'] | undefined
    let unsubscribe: (() => void) | undefined
    setPhase('loading')
    setError('')
    setBootstrap(null)

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

  if (phase === 'loading') return <LoadingScreen />
  if (phase === 'error') return <ErrorScreen message={error} onRetry={() => setAttempt(value => value + 1)} />
  if (!bootstrap) return <LoadingScreen />

  return <ReadyRenderer bootstrap={bootstrap} />
}
