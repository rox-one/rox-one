import * as React from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { cn } from '@/lib/utils'

const loadDiagnostics = () => import('./diagnostics/LazyDiagnostics')

/** An optional diagnostic view must not take down the workspace if its chunk fails. */
class DiagnosticsBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** Closed cost: one existing transport subscription; no diagnostic imports or reads. */
export function DeviceStatusChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [LazyDiagnostics, setLazyDiagnostics] = React.useState(() => React.lazy(loadDiagnostics))
  const transport = useTransportConnectionState()

  const retry = () => {
    // React.lazy caches a rejected promise. A fresh instance performs a real retry.
    setLazyDiagnostics(() => React.lazy(loadDiagnostics))
    setAttempt(value => value + 1)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="device-status-chip"
          aria-label={t('deviceDiagnostics.open')}
          className={cn('inline-flex h-7 min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Cpu className="size-3.5" aria-hidden="true" />
          <span>{t('deviceDiagnostics.device')}</span>
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[min(620px,calc(100vw-32px))] overflow-hidden p-0"
          aria-label={t('deviceDiagnostics.title')}
        >
          <DiagnosticsBoundary key={attempt} fallback={
            <div className="space-y-3 p-4">
              <p role="status" className="text-sm text-muted-foreground">{t('deviceDiagnostics.unavailable.failed')}</p>
              <button type="button" onClick={retry} className="min-h-[var(--control-hit-min)] rounded-md border border-border px-3 text-xs font-medium outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring">{t('common.retry')}</button>
            </div>
          }>
            <React.Suspense fallback={<div role="status" className="p-5 text-sm text-muted-foreground">{t('common.loading')}</div>}>
              <LazyDiagnostics transport={transport} />
            </React.Suspense>
          </DiagnosticsBoundary>
        </PopoverContent>
      )}
    </Popover>
  )
}
