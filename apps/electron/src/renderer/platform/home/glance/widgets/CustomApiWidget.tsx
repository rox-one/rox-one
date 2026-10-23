/** Custom API: GET a JSON URL through home-fetch and show chosen fields. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { ListSkeleton, NetStatus, clampInt, useOnScreen } from './net/kit'
import { display, getPath, parseFieldSpecs } from './net/json-path'
import { safeLink } from './net/parsers'

export default function CustomApiWidget({ config }: GlanceWidgetProps) {
  const { t, i18n } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const url = safeLink(config.url)
  const s = useHomeFetch<unknown>(url?.startsWith('https://') ? url : null, { as: 'json', refreshMs: clampInt(config.refreshMin, 1, 1440, 10) * 60_000, paused: !visible })
  const fields = parseFieldSpecs(config.fields)
  if (!url) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-custom-api="">
      <NetStatus error={s.error} hasData={s.data !== null} onRetry={s.refresh} />
      {s.data === null ? !s.error && <ListSkeleton rows={3} /> : fields.length === 0 ? (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">{display(s.data, i18n.language)}</pre>
      ) : (
        <dl className="grid gap-x-3 gap-y-0.5 text-sm" style={{ gridTemplateColumns: 'auto minmax(0, 1fr)' }}>
          {fields.map((f, i) => (
            <React.Fragment key={`${i}:${f.path}`}>
              <dt className="truncate text-muted-foreground">{f.label}</dt>
              <dd className="truncate text-right font-bold tabular-nums text-foreground">{display(getPath(s.data, f.path), i18n.language)}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
    </div>
  )
}
