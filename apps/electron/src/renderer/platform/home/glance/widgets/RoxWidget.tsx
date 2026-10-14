import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { HOME_GRID_GAP, HOME_GRID_ROW_HEIGHT, isHomeWidgetId, widgetRowSpan, type HomeWidgetSize } from '../../dashboard-layout'
import { HOME_WIDGETS } from '../../widgets'
import type { GlanceWidgetProps } from '../registry'

/** Embeds an existing Rox dashboard widget (sessions, tasks, inbox, calendar, notes, feed…). */
export default function RoxWidget({ config, width }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const id = typeof config.widget === 'string' && isHomeWidgetId(config.widget) ? config.widget : null
  const size: HomeWidgetSize = config.size === 'S' || config.size === 'L' ? config.size : 'M'
  if (!id) return <p className="rox-home-widget rounded-[var(--radius-card)] p-3 text-sm text-muted-foreground">{t('workbench.home.glance.unknownWidget')}</p>
  const rows = widgetRowSpan(size)
  const height = rows * HOME_GRID_ROW_HEIGHT + (rows - 1) * HOME_GRID_GAP
  const Body = HOME_WIDGETS[id].Component
  return (
    <div style={{ height }} className="min-h-0 min-w-0" data-glance-rox={id}>
      <Body edit={null} width={width} size={size} />
    </div>
  )
}
