import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleHelp, DatabaseZap, KeyRound, Search, Settings2, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SourceAvatar } from '@/components/ui/source-avatar'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { reconnectFlavor, ReconnectCredentialDialog } from '@/components/pages/PageSourceAuthBanner'
import { navigate, routes } from '@/lib/navigate'
import { buildCapabilityCatalog, CAPABILITY_CATEGORIES, filterCapabilityCatalog, type CapabilityCategory, type CatalogCapability, type CatalogStatus } from '@/lib/capability-catalog'
import type { CapabilityRef } from '@rox/core/runtime-trace'
import type { LoadedSource, LlmConnectionWithStatus, SourceFilter } from '../../shared/types'

export interface IntegrationsCatalogPageProps {
  workspaceId: string
  workspaceRootPath?: string
  sourceFilter?: SourceFilter | null
  localMcpEnabled?: boolean
  usedCapabilities?: CapabilityRef[]
}
const STATUS_ICON = { connected: CheckCircle2, authenticated: KeyRound, needs_auth: KeyRound, failed: TriangleAlert, untested: CircleHelp, local_disabled: CircleHelp, available: CircleHelp, shadowed: CircleHelp } satisfies Record<CatalogStatus, typeof CircleHelp>
export default function IntegrationsCatalogPage({ workspaceId, workspaceRootPath, sourceFilter, localMcpEnabled = true, usedCapabilities }: IntegrationsCatalogPageProps) {
  const { t } = useTranslation()
  const [sources, setSources] = React.useState<LoadedSource[]>([])
  const [models, setModels] = React.useState<LlmConnectionWithStatus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<CapabilityCategory | 'all'>('all')
  const [connectedOnly, setConnectedOnly] = React.useState(false)
  const [technicalType, setTechnicalType] = React.useState<CatalogCapability['technicalType'] | 'all'>(sourceFilter?.sourceType ?? 'all')
  const [credentialTarget, setCredentialTarget] = React.useState<LoadedSource | null>(null)
  const [busySlug, setBusySlug] = React.useState<string | null>(null)
  const [refresh, setRefresh] = React.useState(0)
  const contextGuard = React.useMemo(() => Symbol(workspaceId), [workspaceId])
  const currentGuard = React.useRef(contextGuard)
  currentGuard.current = contextGuard
  const currentWorkspace = React.useRef(workspaceId)
  currentWorkspace.current = workspaceId
  React.useEffect(() => { setTechnicalType(sourceFilter?.sourceType ?? 'all') }, [sourceFilter?.sourceType])
  React.useEffect(() => {
    let stale = false
    let generation = 0
    setSources([]); setModels([]); setError(null); setLoading(true); setCredentialTarget(null); setBusySlug(null)
    const load = async () => {
      const request = ++generation
      try {
        const [loadedSources, loadedModels] = await Promise.all([
          window.electronAPI.getSources(workspaceId),
          window.electronAPI.listLlmConnectionsWithStatus().catch(() => null),
        ])
        if (stale || request !== generation) return
        setSources(loadedSources.filter(source => source.workspaceId === workspaceId))
        if (loadedModels !== null) setModels(loadedModels)
        setError(loadedModels === null ? t('capabilityCatalog.modelLoadFailed') : null)
      } catch { if (!stale && request === generation) setError(t('capabilityCatalog.loadFailed')) }
      finally { if (!stale && request === generation) setLoading(false) }
    }
    void load()
    const offSources = window.electronAPI.onSourcesChanged(id => { if (id === workspaceId) void load() })
    const offModels = window.electronAPI.onLlmConnectionsChanged(() => void load())
    return () => { stale = true; generation++; offSources(); offModels() }
  }, [workspaceId, refresh, t])
  const allRows = React.useMemo(() => buildCapabilityCatalog({ sources, models, localMcpEnabled, usedCapabilities }), [sources, models, localMcpEnabled, usedCapabilities])
  const rows = React.useMemo(() => filterCapabilityCatalog(allRows, { query, category, technicalType, connectedOnly }).sort((a, b) => a.ref.label.localeCompare(b.ref.label)), [allRows, query, category, technicalType, connectedOnly])
  const handleConnection = async (row: CatalogCapability) => {
    if (row.model) { navigate(routes.view.settings('ai')); return }
    const source = row.source
    if (!source || source.workspaceId !== workspaceId) return
    if (row.status === 'needs_auth') {
      const flavor = reconnectFlavor(source.config)
      if (flavor === 'secret') { setCredentialTarget(source); return }
      if (flavor === 'agent') {
        navigate(routes.action.newSession({ input: t('pages.auth.fixWithAgentPrompt', { name: source.config.name }), send: false }))
        return
      }
      const capturedWorkspace = workspaceId
    const capturedGuard = currentGuard.current
      setBusySlug(source.config.slug)
      try {
        const result = await window.electronAPI.startSourceOAuth(workspaceId, source.config.slug)
        if ((currentWorkspace.current !== capturedWorkspace || currentGuard.current !== capturedGuard)) return
        if (!result.success) throw new Error(result.error ?? t('capabilityCatalog.authFailed'))
        // The lifecycle writes and broadcasts authoritative state. Re-read it;
        // never turn a clicked button into a locally invented Connected badge.
        const readback = await window.electronAPI.getSources(workspaceId)
        if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) setSources(readback.filter(item => item.workspaceId === workspaceId))
      } catch (err) { if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) toast.error(t('capabilityCatalog.authFailed'), { description: err instanceof Error ? err.message : undefined }) }
      finally { if ((currentWorkspace.current === capturedWorkspace && currentGuard.current === capturedGuard)) setBusySlug(null) }
      return
    }
    navigate(routes.view.sources({ sourceSlug: source.config.slug }))
  }
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="integrations-catalog"
      style={{ '--muted-foreground': 'color-mix(in oklch, var(--foreground) 78%, var(--background))' } as React.CSSProperties}>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/50 p-4">
        <div className="mr-auto"><h1 className="flex items-center gap-2 text-base font-semibold"><DatabaseZap className="size-4" />{t('capabilityCatalog.integrationsTitle')}</h1><p className="mt-1 text-xs text-muted-foreground">{t('capabilityCatalog.integrationsDescription')}</p></div>
        <label className="relative"><Search className="absolute left-2 top-2 size-3.5 text-muted-foreground" /><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('capabilityCatalog.searchIntegrations')} aria-label={t('capabilityCatalog.searchIntegrations')} className="h-8 w-52 max-w-full rounded-md border border-border/60 bg-transparent pl-7 pr-2 text-xs" /></label>
        <Button variant="outline" size="sm" onClick={() => navigate(routes.view.connections())}><Settings2 className="mr-1 size-3.5" />{t('capabilityCatalog.credentialsAndPolicies')}</Button>
        {workspaceRootPath && <EditPopover trigger={<Button variant="outline" size="sm">{t('sourcesList.addSource')}</Button>} {...getEditConfig('add-source', workspaceRootPath)} />}
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <nav aria-label={t('capabilityCatalog.category')} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border/40 p-2 md:w-44 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-3">
          <button type="button" aria-pressed={category === 'all' && !connectedOnly} onClick={() => { setCategory('all'); setConnectedOnly(false) }} className={`shrink-0 rounded-md px-2.5 py-2 text-left text-xs ${category === 'all' && !connectedOnly ? 'bg-foreground/5 text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.03]'}`}>{t('capabilityCatalog.all')}</button>
          <button type="button" aria-pressed={connectedOnly} onClick={() => setConnectedOnly(value => !value)} className={`shrink-0 rounded-md px-2.5 py-2 text-left text-xs ${connectedOnly ? 'bg-foreground/5 text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.03]'}`}>{t('capabilityCatalog.status.connected')}</button>
          <span className="hidden px-2.5 pb-1 pt-4 text-[10px] uppercase tracking-wide text-muted-foreground md:block">{t('capabilityCatalog.category')}</span>
          {CAPABILITY_CATEGORIES.map(item => <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={`shrink-0 rounded-md px-2.5 py-2 text-left text-xs ${category === item ? 'bg-foreground/5 text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.03]'}`}>{t(`capabilityCatalog.categories.${item}`)} <span className="ml-1 text-muted-foreground">{allRows.filter(row => row.categories.includes(item)).length}</span></button>)}
        </nav>
        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">
          {error && <p role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
          <div className="mb-4 flex flex-wrap items-center gap-3"><h2 className="mr-auto text-sm font-medium">{t(category === 'all' ? 'capabilityCatalog.allIntegrations' : `capabilityCatalog.categories.${category}`)} <span className="ml-1 text-xs text-muted-foreground">{rows.length}</span></h2><select value={technicalType} aria-label={t('capabilityCatalog.technicalType')} onChange={e => setTechnicalType(e.target.value as typeof technicalType)} className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"><option value="all">{t('capabilityCatalog.allTypes')}</option>{(['mcp', 'api', 'local', 'model'] as const).map(type => <option key={type} value={type}>{t(`capabilityCatalog.types.${type}`)}</option>)}</select></div>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr))]">
            {rows.map(row => {
              const StatusIcon = STATUS_ICON[row.status]
              const actionKey = row.model ? 'capabilityCatalog.configure' : row.status === 'needs_auth' ? row.source?.config.lastTestedAt ? 'capabilityCatalog.reconnect' : 'capabilityCatalog.connect' : row.status === 'connected' ? 'capabilityCatalog.open' : 'capabilityCatalog.configure'
              return <article key={row.key} className="flex min-w-0 flex-col rounded-xl border border-border/60 p-3.5" data-testid="catalog-integration-card" data-source-id={row.ref.id} data-connection-status={row.status}>
                <div className="flex items-start gap-2.5">{row.source ? <SourceAvatar source={row.source} size="sm" /> : <div className="flex size-7 items-center justify-center rounded-md bg-foreground/5"><ZapModelIcon /></div>}<div className="min-w-0"><h3 className="truncate text-sm font-medium" title={row.ref.label}>{row.ref.label}</h3><span className="block truncate text-[10px] text-muted-foreground">{t(`capabilityCatalog.types.${row.technicalType}`)} · {row.ref.id}</span></div></div>
                <p className="mb-3 mt-3 line-clamp-2 text-xs text-muted-foreground">{row.description || '—'}</p>
                <div className="mt-auto space-y-2"><p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><StatusIcon className={`size-3.5 ${row.status === 'connected' ? 'text-success' : row.status === 'failed' ? 'text-destructive' : ''}`} />{t(`capabilityCatalog.status.${row.status}`)}</p>{row.source && <p className="text-[10px] text-muted-foreground">{t('capabilityCatalog.permissionRequirement', { auth: row.source.config.mcp?.authType ?? row.source.config.api?.authType ?? t('capabilityCatalog.noAuth') })}</p>}{row.usedInRun && <p className="text-[10px] text-muted-foreground">{t('capabilityCatalog.usedInRun')}</p>}<Button className="h-7 w-full" variant="outline" size="sm" disabled={busySlug !== null} onClick={() => void handleConnection(row)} aria-label={t('capabilityCatalog.resourceAction', { action: t(actionKey), name: row.ref.label })}>{t(actionKey)}</Button>{row.source && <button type="button" className="block text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground" onClick={() => navigate(routes.view.sources({ sourceSlug: row.ref.id }))}>{t('capabilityCatalog.details')}</button>}</div>
              </article>
            })}
          </div>
          {loading && <p role="status" className="py-5 text-center text-xs text-muted-foreground">{t('common.loading')}</p>}
          {!loading && rows.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">{t('capabilityCatalog.noResults')}</p>}
        </main>
      </div>
      <ReconnectCredentialDialog workspaceId={workspaceId} source={credentialTarget} onClose={() => { setCredentialTarget(null); setRefresh(value => value + 1) }} />
    </div>
  )
}
function ZapModelIcon() { return <DatabaseZap className="size-3.5 text-muted-foreground" /> }
