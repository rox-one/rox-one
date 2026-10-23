/** Markets: last price, day change and a hand-drawn SVG sparkline per symbol. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeFetch } from '@/lib/home-fetch'
import { cn } from '@/lib/utils'
import type { GlanceWidgetProps } from '../registry'
import { ListSkeleton, useOnScreen } from './net/kit'
import { cleanSymbol, parseChart, sparkPoints } from './net/data'
import { openExternalSafe } from '../open-external'

export function chartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`
}

export function symbolList(value: unknown): string[] {
  return [...new Set((Array.isArray(value) ? value : []).map(cleanSymbol).filter((s): s is string => !!s))].slice(0, 20)
}

function Row({ symbol, paused }: { symbol: string; paused: boolean }) {
  const { i18n } = useTranslation()
  const s = useHomeFetch<unknown>(chartUrl(symbol), { as: 'json', refreshMs: 5 * 60_000, paused })
  const q = s.data ? parseChart(s.data) : null
  if (!q) return s.error ? <li className="flex justify-between text-sm text-muted-foreground"><span>{symbol}</span><span>—</span></li> : <li><ListSkeleton rows={1} /></li>
  const change = q.prev ? ((q.price - q.prev) / q.prev) * 100 : 0
  const up = change >= 0
  let price: string
  try { price = new Intl.NumberFormat(i18n.language, q.currency ? { style: 'currency', currency: q.currency, maximumFractionDigits: 2 } : { maximumFractionDigits: 2 }).format(q.price) } catch { price = q.price.toFixed(2) }
  const href = `https://finance.yahoo.com/quote/${encodeURIComponent(q.symbol)}`
  return (
    <li>
      <a href={href} onClick={(e) => { e.preventDefault(); openExternalSafe(href) }} className="flex min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-1 py-0.5 hover:bg-surface-hover">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-foreground">{q.symbol}</span>
          <span className="block truncate text-xs text-muted-foreground">{q.name}</span>
        </span>
        <svg viewBox="0 0 64 20" className={cn('h-5 w-16 shrink-0', up ? 'text-success' : 'text-destructive')} aria-hidden>
          <polyline points={sparkPoints(q.closes, 64, 20)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="flex shrink-0 flex-col items-end tabular-nums">
          <span className="text-sm text-foreground">{price}</span>
          <span className={cn('text-xs', up ? 'text-success' : 'text-destructive')}>{up ? '+' : ''}{change.toFixed(2)}%</span>
        </span>
      </a>
    </li>
  )
}

export default function MarketsWidget({ config }: GlanceWidgetProps) {
  const { t } = useTranslation()
  const [ref, visible] = useOnScreen<HTMLDivElement>()
  const symbols = React.useMemo(() => symbolList(config.symbols), [config.symbols])
  if (symbols.length === 0) return <p className="text-sm text-muted-foreground">{t('glance.configureHint')}</p>
  return (
    <div ref={ref} className="min-h-[1px]">
      <ul className="flex flex-col gap-1" data-glance-markets="">
        {symbols.map((s) => <Row key={s} symbol={s} paused={!visible} />)}
      </ul>
    </div>
  )
}
