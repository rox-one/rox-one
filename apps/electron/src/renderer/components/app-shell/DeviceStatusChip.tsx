import * as React from 'react'
import { ChevronDown, Cpu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { cn } from '@/lib/utils'

const LazyDiagnostics = React.lazy(() => import('./diagnostics/LazyDiagnostics'))

/** Closed cost: one existing transport subscription; no diagnostic imports or reads. */
export function DeviceStatusChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const transport = useTransportConnectionState()

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
          <React.Suspense fallback={<div role="status" className="p-5 text-sm text-muted-foreground">{t('common.loading')}</div>}>
            <LazyDiagnostics transport={transport} />
          </React.Suspense>
        </PopoverContent>
      )}
    </Popover>
  )
}
