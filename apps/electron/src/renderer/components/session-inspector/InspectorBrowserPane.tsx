import * as React from 'react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import BrowserPanelPage from '@/pages/BrowserPanelPage'
import { INTERNAL_BROWSER_OPEN_EVENT, planRetainedBrowserOpen } from '@craft-agent/shared/browser/retained-pane'
import { takePendingInternalBrowserUrl } from '@/components/browser/internal-browser-queue'

/** Embedded BrowserView hosted in the inspector column. */
export function InspectorBrowserPane() {
  const { t } = useTranslation()
  const [instanceId, setInstanceId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const createdRef = React.useRef<string | null>(null)

  const attach = React.useCallback(async (url?: string) => {
    const existing = await window.electronAPI.browserPane.list()
    const plan = planRetainedBrowserOpen(existing, url)
    if (plan.action === 'navigate') {
      createdRef.current = plan.id
      setInstanceId(plan.id)
      if (plan.url) await window.electronAPI.browserPane.navigate(plan.id, plan.url)
      return
    }
    const id = await window.electronAPI.browserPane.createEmbedded(plan.url ? { url: plan.url } : undefined)
    createdRef.current = id
    setInstanceId(id)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    void attach(takePendingInternalBrowserUrl()).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })
    const onOpen = (event: Event) => {
      const nextUrl = (event as CustomEvent<{ url?: string }>).detail?.url ?? takePendingInternalBrowserUrl()
      void attach(nextUrl).catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    }
    window.addEventListener(INTERNAL_BROWSER_OPEN_EVENT, onOpen)
    return () => {
      cancelled = true
      window.removeEventListener(INTERNAL_BROWSER_OPEN_EVENT, onOpen)
      const id = createdRef.current
      if (id) {
        void window.electronAPI.browserPane.syncBounds(id, null).catch(() => undefined)
      }
    }
  }, [attach])

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
      <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }

  return (
    <div className="relative min-h-0 w-full flex-1">
      <div className="absolute inset-0 min-h-0 min-w-0">
        <BrowserPanelPage instanceId={instanceId} persist />
      </div>
    </div>
  )
}
