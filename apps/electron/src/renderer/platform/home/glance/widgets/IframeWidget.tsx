import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { GlanceWidgetProps } from '../registry'
import { safeHttpUrl } from '../registry'

export default function IframeWidget({ config, instance }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const url = safeHttpUrl(config.url)
  const height = typeof config.height === 'number' ? Math.min(1600, Math.max(80, Math.round(config.height))) : 300
  if (!url || !url.startsWith('https:')) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  let host = url
  try { host = new URL(url).host } catch { /* keep url */ }
  return (
    <div className="flex min-h-[1px] flex-col gap-1" data-glance-iframe="">
      <div className="truncate px-0.5 text-xs text-muted-foreground" title={url}>{instance.title?.trim() || host}</div>
      <iframe
        src={url}
        title={instance.title?.trim() || host}
        sandbox="allow-scripts allow-forms allow-popups"
        referrerPolicy="no-referrer"
        loading="lazy"
        className="w-full rounded-[var(--radius-control)] border-0 bg-background"
        style={{ height }}
      />
    </div>
  )
}
