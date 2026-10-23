/** This machine: CPU, memory, disk bars and load/uptime (main-process stats). */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { homeFetchApi } from '@/lib/home-fetch'
import type { HomeSystemStats } from '../../../../../shared/home-fetch'
import type { GlanceWidgetProps } from '../registry'
import { ListSkeleton, usePoll, useOnScreen } from './net/kit'

export function formatBytes(n: number, locale: string): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: v < 10 ? 1 : 0 }).format(v)} ${units[i]}`
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60)
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`
}

function Bar({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  const pct = value === null ? null : Math.round(value * 100)
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex justify-between text-xs"><span className="font-bold text-foreground">{label}</span><span className="tabular-nums text-muted-foreground">{pct === null ? '—' : `${pct}%`} {detail}</span></div>
      <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="h-1.5 w-full" role="img" aria-label={`${label} ${pct ?? '—'}%`}>
        <rect width="100" height="4" rx="2" className="fill-surface-hover" />
        {pct !== null && <rect width={Math.max(2, pct)} height="4" rx="2" className={pct > 90 ? 'fill-destructive' : 'fill-foreground'} />}
      </svg>
    </div>
  )
}

export default function ServerStatsWidget(_: GlanceWidgetProps) {
  const { t, i18n } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const fetchStats = React.useCallback(() => homeFetchApi()?.system() ?? Promise.reject(new Error('no bridge')), [])
  const { data } = usePoll<HomeSystemStats>(fetchStats, 10_000, visible)
  const fb = (n: number) => formatBytes(n, i18n.language)
  return (
    <div ref={ref} className="flex min-h-[1px] flex-col gap-2" data-glance-server-stats="">
      {data ? (
        <>
          <Bar label={t('deviceDiagnostics.cpu')} value={data.cpu} detail={`· ${data.cpus}×`} />
          <Bar label={t('entities.kind.memory')} value={data.memTotal ? data.memUsed / data.memTotal : null} detail={`· ${fb(data.memUsed)} / ${fb(data.memTotal)}`} />
          {data.diskTotal ? <Bar label={t('glance.s.disk')} value={(data.diskUsed ?? 0) / data.diskTotal} detail={`· ${fb(data.diskUsed ?? 0)} / ${fb(data.diskTotal)}`} /> : null}
          <p className="text-xs tabular-nums text-muted-foreground">
            {data.platform !== 'win32' ? `${t('glance.s.load', { value: data.load.map((l) => l.toFixed(2)).join(' ') })} · ` : ''}{t('glance.s.uptime', { value: formatUptime(data.uptimeSec) })}
          </p>
        </>
      ) : <ListSkeleton rows={3} />}
    </div>
  )
}
