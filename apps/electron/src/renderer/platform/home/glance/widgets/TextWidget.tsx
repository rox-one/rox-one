import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { GlanceWidgetProps } from '../registry'

/** Plain text / notes card. Rendered as text (never as HTML) for safety. */
export default function TextWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const text = typeof config.text === 'string' ? config.text : ''
  if (!text.trim()) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return <p className="whitespace-pre-wrap break-words text-sm text-foreground" data-glance-text="">{text}</p>
}
