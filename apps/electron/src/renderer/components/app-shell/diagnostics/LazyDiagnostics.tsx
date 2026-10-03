import * as React from 'react'
import { Activity, ArrowDown, ArrowUp, Check, Copy, Cpu, HardDrive, RefreshCw, Server, Terminal, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DeviceDiagnosticLogSource, DeviceDiagnosticReason, DeviceDiagnosticSnapshot } from '../../../../shared/device-diagnostics'
import type { TransportConnectionState } from '../../../../shared/types'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { cn } from '@/lib/utils'
import { diagnosticConnection, networkRates } from './diagnostics-model'
import { useDiagnostics, type DiagnosticsTab, type ServerDiagnosticsSnapshot } from './use-diagnostics'

const TABS = [
  { id: 'overview', icon: Cpu },
  { id: 'network', icon: Wifi },
  { id: 'processes', icon: Activity },
  { id: 'servers', icon: Server },
  { id: 'launchAgents', icon: HardDrive },
  { id: 'logs', icon: Terminal },
] as const

const REASONS: Record<DeviceDiagnosticReason | 'native-only', string> = {
  'unsupported-platform': 'deviceDiagnostics.unavailable.platform',
  'permission-denied': 'deviceDiagnostics.unavailable.permission',
  'command-unavailable': 'deviceDiagnostics.unavailable.command',
  disabled: 'deviceDiagnostics.unavailable.disabled',
  'no-data': 'deviceDiagnostics.unavailable.noData',
  failed: 'deviceDiagnostics.unavailable.failed',
  cancelled: 'deviceDiagnostics.unavailable.cancelled',
  'native-only': 'deviceDiagnostics.unavailable.native',
}

function Metric({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return <div className="min-w-0 rounded-lg border border-border/60 bg-foreground/[0.025] p-3">
    <div className="text-[11px] text-muted-foreground">{label}</div>
    <div className="mt-1 text-xl font-medium tabular-nums tracking-tight">{value}</div>
    {detail && <div className="mt-1 text-[11px] text-muted-foreground">{detail}</div>}
  </div>
}

function Unavailable({ reason }: { reason: keyof typeof REASONS }) {
  const { t } = useTranslation()
  return <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground" role="status">
    <p className="font-medium text-foreground">{t('common.unavailable')}</p>
    <p className="mt-1 text-xs leading-5">{t(REASONS[reason])}</p>
  </div>
}

export default function LazyDiagnostics({ transport }: { transport: TransportConnectionState | null }) {
  const { t, i18n } = useTranslation()
  const [tab, setTab] = React.useState<DiagnosticsTab>('overview')
  const [source, setSource] = React.useState<DeviceDiagnosticLogSource>('main')
  const [copied, setCopied] = React.useState(false)
  const [copyFailed, setCopyFailed] = React.useState(false)
  const copyReset = React.useRef<ReturnType<typeof setTimeout>>()
  const mounted = React.useRef(true)
  const workspaceId = useOptionalAppShellContext()?.activeWorkspaceId
  const serverScope = tab === 'servers' ? `${workspaceId ?? ''}:${transport?.url ?? ''}:${transport?.status ?? ''}` : ''
  const { snapshot, previous, loading, paused, error, refresh } = useDiagnostics(tab, source, serverScope)
  const tabId = React.useId()
  const connection = diagnosticConnection(transport)
  const number = (value: number, digits = 1) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(value)
  const bytes = (value: number | null) => {
    if (value === null) return t('common.unavailable')
    const power = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : value >= 1024 ? 1 : 0
    const unit = (['bytes', 'kib', 'mib', 'gib'] as const)[power]!
    return t(`deviceDiagnostics.units.${unit}`, { value: number(value / 1024 ** power) })
  }
  const percent = (value: number | null) => value === null ? t('common.unavailable') : new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 1 }).format(value / 100)

  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; if (copyReset.current) clearTimeout(copyReset.current) }
  }, [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ connection, snapshot }, null, 2))
      if (!mounted.current) return
      setCopied(true)
      setCopyFailed(false)
      if (copyReset.current) clearTimeout(copyReset.current)
      copyReset.current = setTimeout(() => setCopied(false), 1800)
    } catch { if (mounted.current) setCopyFailed(true) }
  }

  const renderNative = (value: DeviceDiagnosticSnapshot) => {
    if (value.result.status !== 'available') return <Unavailable reason={value.result.reason} />
    // Narrow discriminated snapshots inside each case (kind and payload travel together).
    switch (value.kind) {
      case 'overview': {
        if (value.result.status !== 'available') return null
        const data = value.result.data
        const used = data.memoryTotalBytes - data.memoryFreeBytes
        return <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric label={t('deviceDiagnostics.cpu')} value={percent(data.cpuPercent)} detail={t('deviceDiagnostics.logicalCpus', { count: data.cpuCount })} />
            <Metric label={t('deviceDiagnostics.ram')} value={bytes(used)} detail={t('deviceDiagnostics.ofTotal', { total: bytes(data.memoryTotalBytes) })} />
            <Metric label={t('deviceDiagnostics.appMemory')} value={bytes(data.appMemoryBytes)} />
            <Metric label={t('deviceDiagnostics.uptime')} value={t('deviceDiagnostics.minutes', { value: number(data.appUptimeSeconds / 60, 0) })} />
          </div>
          <p className="text-[11px] leading-5 text-muted-foreground">{t('deviceDiagnostics.memoryNote')}</p>
        </div>
      }
      case 'network': {
        if (value.result.status !== 'available') return null
        const rates = networkRates(value, previous)
        const countersAvailable = value.result.data.interfaces.some(row => row.receivedBytes !== null && row.sentBytes !== null)
        return <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Metric label={t('deviceDiagnostics.receiving')} value={<span className="inline-flex items-center gap-1"><ArrowDown className="size-4" />{rates ? t('deviceDiagnostics.perSecond', { value: bytes(rates.receivedBytesPerSecond) }) : '—'}</span>} />
            <Metric label={t('deviceDiagnostics.sending')} value={<span className="inline-flex items-center gap-1"><ArrowUp className="size-4" />{rates ? t('deviceDiagnostics.perSecond', { value: bytes(rates.sentBytesPerSecond) }) : '—'}</span>} />
          </div>
          <p className="text-[11px] text-muted-foreground">{t(!countersAvailable ? 'deviceDiagnostics.networkUnavailable' : rates ? 'deviceDiagnostics.networkTotals' : 'deviceDiagnostics.networkSampling')}</p>
          <table className="w-full text-xs"><thead className="text-left text-[10px] text-muted-foreground"><tr><th className="pb-2 font-medium">{t('deviceDiagnostics.interface')}</th><th className="pb-2 text-right font-medium">{t('deviceDiagnostics.received')}</th><th className="pb-2 text-right font-medium">{t('deviceDiagnostics.sent')}</th></tr></thead>
            <tbody>{value.result.data.interfaces.map(row => <tr key={row.name} className="border-t border-border/40"><td className="py-2"><code>{row.name}</code>{row.internal && <span className="ml-2 text-[10px] text-muted-foreground">{t('deviceDiagnostics.loopback')}</span>}</td><td className="py-2 text-right tabular-nums">{bytes(row.receivedBytes)}</td><td className="py-2 text-right tabular-nums">{bytes(row.sentBytes)}</td></tr>)}</tbody>
          </table>
          {value.result.data.interfaces.length === 0 && <Unavailable reason="no-data" />}
        </div>
      }
      case 'processes': {
        if (value.result.status !== 'available') return null
        return <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">{t('deviceDiagnostics.processesNote')}</p>
          <table className="w-full table-fixed text-xs"><thead className="text-left text-[10px] text-muted-foreground"><tr><th className="w-[46%] pb-2 font-medium">{t('deviceDiagnostics.process')}</th><th className="pb-2 text-right font-medium">{t('deviceDiagnostics.pid')}</th><th className="pb-2 text-right font-medium">{t('deviceDiagnostics.cpu')}</th><th className="pb-2 text-right font-medium">{t('deviceDiagnostics.ram')}</th></tr></thead><tbody>
            {value.result.data.processes.map(row => <tr key={row.pid} className="border-t border-border/40"><td className="truncate py-2 pr-2" title={row.name}>{row.name}</td><td className="py-2 text-right font-mono text-[10px] text-muted-foreground">{row.pid}</td><td className="py-2 text-right tabular-nums">{percent(row.cpuPercent)}</td><td className="py-2 text-right tabular-nums">{bytes(row.memoryBytes)}</td></tr>)}
          </tbody></table>
          {value.result.data.processes.length === 0 && <Unavailable reason="no-data" />}
        </div>
      }
      case 'launchAgents': {
        if (value.result.status !== 'available') return null
        return <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">{t('deviceDiagnostics.launchAgentsNote')}</p>
          <div className="divide-y divide-border/40">{value.result.data.agents.map(agent => <div key={agent.label} className="flex items-center justify-between gap-3 py-2 text-xs">
            <code className="min-w-0 truncate text-[11px]" title={agent.label}>{agent.label}</code>
            <span className={cn('shrink-0 text-[10px]', agent.pid ? 'text-muted-foreground' : agent.lastExitStatus !== 0 ? 'text-destructive' : 'text-muted-foreground')}>
              {agent.pid ? t('deviceDiagnostics.runningPid', { pid: agent.pid }) : agent.lastExitStatus === 0 ? t('deviceDiagnostics.idle') : t('deviceDiagnostics.exitStatus', { status: agent.lastExitStatus })}
            </span>
          </div>)}</div>
          {value.result.data.agents.length === 0 && <Unavailable reason="no-data" />}
        </div>
      }
      case 'logs': {
        if (value.result.status !== 'available') return null
        return <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">{t('deviceDiagnostics.logsNote')}</p>
          {value.result.data.lines.length ? <pre className="whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-foreground/[0.025] p-3 font-mono text-[10px] leading-5">{value.result.data.lines.join('\n')}</pre> : <Unavailable reason="no-data" />}
          {value.result.data.truncated && <p className="text-[11px] text-muted-foreground">{t('deviceDiagnostics.logsTruncated')}</p>}
        </div>
      }
    }
  }

  const renderServers = (value: ServerDiagnosticsSnapshot) => <div className="space-y-4">
    <section className="space-y-2">
      <h3 className="text-xs font-medium">{t('deviceDiagnostics.workspaceServer')}</h3>
      {connection ? <dl className="space-y-2 rounded-lg border border-border/60 p-3 text-xs">
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('deviceDiagnostics.connection')}</dt><dd>{t(`deviceDiagnostics.connectionStatus.${connection.status}`)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('deviceDiagnostics.mode')}</dt><dd>{t(`deviceDiagnostics.modeValue.${connection.mode}`)}</dd></div>
        {connection.endpoint && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('deviceDiagnostics.endpoint')}</dt><dd className="truncate font-mono text-[10px]">{connection.endpoint}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('deviceDiagnostics.reconnectAttempts')}</dt><dd>{connection.attempt}</dd></div>
        {connection.errorKind && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('deviceDiagnostics.lastError')}</dt><dd>{t(`deviceDiagnostics.errorKind.${connection.errorKind}`)}</dd></div>}
        {connection.closeCode !== null && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t('deviceDiagnostics.closeCode')}</dt><dd>{connection.closeCode}</dd></div>}
      </dl> : <Unavailable reason="no-data" />}
      {value.health?.checks?.length ? <div className="divide-y divide-border/40">{value.health.checks.slice(0, 20).map((check, index) => <div key={`${check.name}-${index}`} className="flex items-start justify-between gap-3 py-2 text-xs">
        <div className="min-w-0"><p className="font-medium">{t(`deviceDiagnostics.healthCheck.${check.name}`, { defaultValue: check.name })}</p><p className="mt-1 break-words text-[11px] text-muted-foreground">{check.message}</p></div><span className={cn('shrink-0 text-[10px]', check.status === 'fail' ? 'text-destructive' : 'text-muted-foreground')}>{t(`deviceDiagnostics.checkStatus.${check.status}`)}</span>
      </div>)}</div> : <Unavailable reason="failed" />}
    </section>
    <section className="space-y-2">
      <h3 className="text-xs font-medium">{t('deviceDiagnostics.localListener')}</h3>
      {value.listener ? <div className="rounded-lg border border-border/60 p-3 text-xs"><div className="flex items-center justify-between gap-3"><span>{t(value.listener.running ? 'deviceDiagnostics.running' : 'deviceDiagnostics.stopped')}</span><code className="truncate text-[10px] text-muted-foreground">{value.listener.endpoint}</code></div>{value.listener.needsRestart && <p className="mt-2 text-muted-foreground">{t('deviceDiagnostics.restartPending')}</p>}</div> : <Unavailable reason="failed" />}
    </section>
  </div>

  return <div data-testid="device-diagnostics" className="text-foreground">
    <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
      <div><h2 className="text-sm font-semibold">{t('deviceDiagnostics.title')}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{t('deviceDiagnostics.localDevice')}</p></div>
      <div className="flex items-center gap-1">
        <button type="button" onClick={copy} disabled={!snapshot} aria-label={t(copied ? 'common.copied' : 'deviceDiagnostics.copySnapshot')} title={t(copied ? 'common.copied' : 'deviceDiagnostics.copySnapshot')} className="flex size-7 min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}</button>
        <button type="button" onClick={refresh} disabled={loading || paused} aria-label={t('common.refresh')} title={t('common.refresh')} className="flex size-7 min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"><RefreshCw className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')} /></button>
      </div>
    </div>
    <div role="tablist" aria-label={t('deviceDiagnostics.sections')} className="flex gap-0.5 overflow-x-auto border-b border-border/60 p-1.5">
      {TABS.map(({ id, icon: Icon }, index) => <button
        key={id} type="button" role="tab" id={`${tabId}-${id}`} aria-controls={`${tabId}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1}
        onClick={() => setTab(id)}
        onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index - 1 + TABS.length) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
          if (next === null) return
          event.preventDefault()
          const nextId = TABS[next]!.id
          setTab(nextId)
          document.getElementById(`${tabId}-${nextId}`)?.focus()
        }}
        className={cn('inline-flex h-8 min-h-[var(--control-hit-min)] min-w-[var(--control-hit-min)] shrink-0 items-center gap-1.5 rounded-md px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === id ? 'bg-foreground/7 font-medium text-foreground' : 'text-muted-foreground hover:bg-foreground/5')}
      ><Icon className="size-3.5" aria-hidden="true" />{t(`deviceDiagnostics.tabs.${id}`)}</button>)}
    </div>
    <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} tabIndex={0} className="h-[360px] max-h-[calc(100vh-250px)] min-h-40 overflow-auto overscroll-contain p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" aria-busy={loading}>
      {tab === 'logs' && <label className="mb-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">{t('deviceDiagnostics.logSource')}
        <select value={source} onChange={event => setSource(event.target.value as DeviceDiagnosticLogSource)} className="h-7 min-h-[var(--control-hit-min)] rounded-md border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {(['main', 'messaging', 'updates'] as const).map(value => <option key={value} value={value}>{t(`deviceDiagnostics.logSources.${value}`)}</option>)}
        </select>
      </label>}
      {error ? <Unavailable reason={error} /> : snapshot ? snapshot.kind === 'servers' ? renderServers(snapshot) : renderNative(snapshot) : <p role="status" className="py-8 text-center text-xs text-muted-foreground">{t(paused ? 'deviceDiagnostics.paused' : 'common.loading')}</p>}
    </div>
    <div className="flex min-h-8 items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
      <span>{t(paused ? 'deviceDiagnostics.paused' : ['overview', 'network', 'processes'].includes(tab) ? 'deviceDiagnostics.autoRefresh' : 'deviceDiagnostics.onDemand')}</span>
      <span aria-live="off">{copyFailed ? t('deviceDiagnostics.copyFailed') : copied ? t('common.copied') : snapshot ? t('deviceDiagnostics.updated', { time: new Intl.DateTimeFormat(i18n.language, { timeStyle: 'medium' }).format(snapshot.sampledAt) }) : ''}</span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{copyFailed ? t('deviceDiagnostics.copyFailed') : copied ? t('common.copied') : ''}</span>
    </div>
  </div>
}
