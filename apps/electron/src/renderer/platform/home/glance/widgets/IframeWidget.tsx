import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { GlanceWidgetProps } from '../registry'
import { safeHttpUrl } from '../registry'

export default function IframeWidget({ config, instance }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const url = safeHttpUrl(config.url)
  const height = typeof config.height === 'number' ? config.height : 300
  if (!url || !url.startsWith('https:')) return <p className="text-sm text-muted-foreground">{t('workbench.home.glance.iframe.needUrl')}</p>
  return (
    <iframe
      src={url}
      title={instance.title ?? url}
      sandbox="allow-scripts allow-forms allow-popups"
      referrerPolicy="no-referrer"
      loading="lazy"
      className="w-full rounded-[var(--radius-control)] border-0 bg-background"
      style={{ height }}
      data-glance-iframe=""
    />
  )
}
