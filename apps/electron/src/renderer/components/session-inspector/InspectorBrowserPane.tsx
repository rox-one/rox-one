import * as React from 'react'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import BrowserPanelPage from '@/pages/BrowserPanelPage'

/** Embedded BrowserView hosted in the inspector column. */
export function InspectorBrowserPane() {
  const { t } = useTranslation()
  const [instanceId, setInstanceId] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const createdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const existing = await window.electronAPI.browserPane.list()
        await Promise.all(
          existing
            .filter((item) => item.embedded)
            .map((item) => window.electronAPI.browserPane.destroy(item.id).catch(() => undefined)),
        )
        const id = await window.electronAPI.browserPane.createEmbedded()
        if (cancelled) {
          await window.electronAPI.browserPane.destroy(id).catch(() => undefined)
          return
        }
        createdRef.current = id
        setInstanceId(id)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      const id = createdRef.current
      createdRef.current = null
      if (id) {
        void window.electronAPI.browserPane.syncBounds(id, null).catch(() => undefined)
        void window.electronAPI.browserPane.destroy(id).catch(() => undefined)
      }
    }
  }, [])

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
    <div className="relative h-full min-h-0 w-full flex-1">
      <BrowserPanelPage instanceId={instanceId} persist />
    </div>
  )
}
