import * as React from 'react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import BrowserPanelPage from '@/pages/BrowserPanelPage'
import { INTERNAL_BROWSER_OPEN_EVENT, planRetainedBrowserOpen, ROX_BROWSER_COOKIE_IMPORT_PARTITION } from '@rox/shared/browser/retained-pane'
import { takePendingInternalBrowserUrl } from '@/components/browser/internal-browser-queue'
import type { BrowserCookieAutoStatus } from '../../../shared/types'
import { createNativeSurfaceLifetime } from '@/lib/native-surface-owners'
import { releaseNativeSurface } from '@/lib/native-surface-dom'
import { toErrorMessage } from '@/lib/errors'

/** Embedded BrowserView hosted in the inspector column. */
export function InspectorBrowserPane() {
  const { t } = useTranslation()
  const [instanceId, setInstanceId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [cookieStatus, setCookieStatus] = React.useState<BrowserCookieAutoStatus | null>(null)
  const [useImportedCookies, setUseImportedCookies] = React.useState(true)
  const createdImportedRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const refreshConsent = () => {
      void window.electronAPI.browserCookieAutoStatus()
        .then((status) => {
          setCookieStatus(status)
          if (status.consent) setUseImportedCookies(true)
          else setUseImportedCookies(false)
        })
        .catch(() => setCookieStatus(null))
    }
    refreshConsent()
    const timer = window.setInterval(refreshConsent, 10_000)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    let requestGeneration = 0
    const hide = (id: string) => {
      void releaseNativeSurface(id, (nativeId, rect) => window.electronAPI.browserPane.syncBounds(nativeId, rect)).catch(() => undefined)
    }
    const lifetime = createNativeSurfaceLifetime(hide)
    const claim = (id: string, generation: number) => {
      if (cancelled || generation !== requestGeneration) { hide(id); return false }
      return lifetime.claim(id)
    }
    const attach = async (url?: string) => {
      const generation = ++requestGeneration
      try {
        if (useImportedCookies && cookieStatus?.consent) {
          // Cookie isolation is fixed when an instance is created, so a pane made
          // without the import partition can never gain it by navigation. A
          // retained pane that already carries the partition is reused as-is;
          // any other retained pane is dropped and recreated with imported cookies.
          const previous = createdImportedRef.current
          createdImportedRef.current = null
          if (previous) await window.electronAPI.browserPane.destroy(previous).catch(() => undefined)
          const existing = await window.electronAPI.browserPane.list()
          if (cancelled || generation !== requestGeneration) return
          const plan = planRetainedBrowserOpen(existing, url)
          if (plan.action === 'navigate' && existing.find((item) => item.id === plan.id)?.partition === ROX_BROWSER_COOKIE_IMPORT_PARTITION) {
            if (!claim(plan.id, generation)) return
            setInstanceId(plan.id)
            setError(null)
            if (plan.url) await window.electronAPI.browserPane.navigate(plan.id, plan.url)
            return
          }
          if (plan.action === 'navigate') {
            await window.electronAPI.browserPane.destroy(plan.id).catch(() => undefined)
          }
          const id = await window.electronAPI.browserPane.createEmbedded({ url, useImportedCookies: true })
          if (!claim(id, generation)) {
            // This cookie-isolated instance was created only for the superseded request.
            void window.electronAPI.browserPane.destroy(id).catch(() => undefined)
            return
          }
          createdImportedRef.current = id
          setInstanceId(id)
          setError(null)
          return
        }
        if (createdImportedRef.current) {
          const previous = createdImportedRef.current
          createdImportedRef.current = null
          await window.electronAPI.browserPane.destroy(previous)
        }
        const existing = await window.electronAPI.browserPane.list()
        if (cancelled || generation !== requestGeneration) return
        const plan = planRetainedBrowserOpen(existing, url)
        const id = plan.action === 'navigate' ? plan.id
          : await window.electronAPI.browserPane.createEmbedded(plan.url ? { url: plan.url } : undefined)
        if (!claim(id, generation)) return
        setInstanceId(id)
        setError(null)
        if (plan.action === 'navigate' && plan.url) await window.electronAPI.browserPane.navigate(id, plan.url)
      } catch (err) {
        if (!cancelled && generation === requestGeneration) setError(toErrorMessage(err))
      }
    }
    void attach(takePendingInternalBrowserUrl())
    const onOpen = (event: Event) => {
      const nextUrl = (event as CustomEvent<{ url?: string }>).detail?.url ?? takePendingInternalBrowserUrl()
      void attach(nextUrl)
    }
    window.addEventListener(INTERNAL_BROWSER_OPEN_EVENT, onOpen)
    return () => {
      cancelled = true
      requestGeneration += 1
      window.removeEventListener(INTERNAL_BROWSER_OPEN_EVENT, onOpen)
      const importedId = createdImportedRef.current
      createdImportedRef.current = null
      if (importedId) {
        void window.electronAPI.browserPane.destroy(importedId).catch(() => undefined)
      }
      lifetime.release()
    }
  }, [cookieStatus?.consent, useImportedCookies])

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Globe className="h-6 w-6 text-destructive/70" />
        <span className="text-[13px] font-medium text-foreground/80">{t('toast.failedToCreateBrowser')}</span>
        <span className="text-[12px] text-muted-foreground/70">{error}</span>
      </div>
    )
  }

  if (!instanceId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-[12px] text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div className="relative min-h-0 w-full flex-1">
        <div className="absolute inset-0 min-h-0 min-w-0">
          <BrowserPanelPage instanceId={instanceId} persist />
        </div>
      </div>
    </div>
  )
}
