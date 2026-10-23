/**
 * Change detection: hashes a page's visible text (or one JSON value) and
 * remembers the hash + when it last changed in the widget config.
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { NetStatus, StatusDot, clampInt, relTime, useOnScreen } from './net/kit'
import { getPath, hashText, pageText } from './net/json-path'
import { safeLink } from './net/parsers'
import { openExternalSafe } from '../open-external'

export function contentFingerprint(raw: string, path: string): string {
  if (path.trim()) {
    try { return hashText(JSON.stringify(getPath(JSON.parse(raw), path)) ?? '') } catch { return hashText('') }
  }
  return hashText(pageText(raw))
}

export default function ChangeDetectionWidget({ config, onConfig }: GlanceWidgetProps) {
  const { t, i18n } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const url = safeLink(config.url)
  const path = typeof config.path === 'string' ? config.path : ''
  const s = useHomeFetch<string>(url?.startsWith('https://') ? url : null, { as: 'text', refreshMs: clampInt(config.refreshMin, 5, 1440, 60) * 60_000, paused: !visible })
  const hash = typeof s.data === 'string' ? contentFingerprint(s.data, path) : null
  const last = typeof config.lastHash === 'string' ? config.lastHash : ''
  const changedAt = typeof config.changedAt === 'number' ? config.changedAt : 0
  const seenAt = typeof config.seenAt === 'number' ? config.seenAt : 0
  React.useEffect(() => {
    if (!hash || hash === last) return
    onConfig({ ...config, lastHash: hash, ...(last ? { changedAt: Date.now() } : { seenAt: Date.now() }) })
  }, [hash]) // eslint-disable-line react-hooks/exhaustive-deps -- persist once per new fingerprint
  if (!url) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  const fresh = changedAt > seenAt
  const host = (() => { try { return new URL(url).host } catch { return url } })()
  return (
    <div ref={ref} className="min-h-[1px]" data-glance-change={fresh ? 'changed' : 'same'}>
      <NetStatus error={s.error} hasData={!!hash} onRetry={s.refresh} />
      <a href={url} onClick={(e) => { e.preventDefault(); openExternalSafe(url); if (fresh) onConfig({ ...config, seenAt: Date.now() }) }} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-surface-hover">
        <StatusDot ok={fresh ? false : hash ? true : null} />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-foreground">{host}{path ? ` · ${path}` : ''}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {changedAt ? t('glance.net.changed', { time: relTime(changedAt, i18n.language) }) : t('memory.repo.history.noChanges')}
        </span>
      </a>
    </div>
  )
}
