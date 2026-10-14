/**
 * Functional bottom status bar (demo.rox.one parity).
 *
 * A ~24px strip at the bottom of the shell. Every item is a button backed by
 * real data, nothing is a placeholder:
 *  left  — workspace/connection (popover with transport details + reconnect),
 *          sync state (click retries), sessions / active agents / tasks today /
 *          inbox counters (click opens the section);
 *  right — current model (popover picker over the real LLM connections),
 *          Rox balance from api.rox.one (hidden when unavailable), notifications
 *          (latest inbox item + count) and the version with an update check.
 *
 * Visibility is owned by the «Интерфейс» preference (`ui.statusBar`); AppShell
 * mounts this only when it is on and the layout is not compact. The bar is
 * also rendered standalone in tests, so it never requires AppShellContext.
 */
import * as React from 'react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import { Bell, Bot, Cpu, Inbox, ListTodo, MessageSquare, RefreshCw, Wallet } from 'lucide-react'
import { useTransportConnectionState } from '@/hooks/useTransportConnectionState'
import { useWorkspaceTaskCount } from '@/hooks/useWorkspaceTaskCount'
import { useInboxItems } from '@/hooks/useInboxItems'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'
import { isHomeSessionInWorkspace } from '@/platform/home-model'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { buildStatusBarModel, type WorkspaceRuntimeMode } from '@/platform/status-model'
import { CHROME_DENSITY } from '@/platform/chrome-density'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { RoxAccountSnapshot } from '@rox/shared/auth'
import type { UpdateInfo } from '@rox/shared/protocol'

const STATUS_BAR_HEIGHT = CHROME_DENSITY.statusBarHeight
const BALANCE_REFRESH_MS = 60_000

const itemCls = 'inline-flex h-[18px] min-w-0 items-center gap-1 rounded-[4px] px-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none'
const numCls = 'numeric font-semibold text-foreground'
const sepCls = 'h-3 w-px shrink-0 bg-foreground/10'
const popCls = 'w-64 p-2 text-xs'

function workspaceModeLabel(mode: WorkspaceRuntimeMode, t: (key: string) => string): string {
  switch (mode) {
    case 'local':
      return t('workbench.status.local')
    case 'remote':
      return t('workbench.status.remote')
    case 'offline':
      return t('workbench.status.offline')
    default: {
      const _exhaustive: never = mode
      return _exhaustive
    }
  }
}

/** Real rox.one balance: GET /api/me/balance via main, fallback to the account snapshot. */
export function resolveStatusBalance(
  remote: { status: 'ok'; balance: number } | { status: string } | null,
  account: RoxAccountSnapshot | null,
): number | null {
  if (remote && remote.status === 'ok' && 'balance' in remote && Number.isFinite(remote.balance)) return remote.balance
  const fromAccount = account ? Number(account.balance?.availableRox) : NaN
  return Number.isFinite(fromAccount) ? fromAccount : null
}

function useRoxBalance(account: RoxAccountSnapshot | null): number | null {
  const [remote, setRemote] = React.useState<{ status: 'ok'; balance: number } | { status: string } | null>(null)
  React.useEffect(() => {
    const api = window.electronAPI
    if (!api?.getRoxBalance) return
    let cancelled = false
    const read = () => {
      void api.getRoxBalance()
        .then((r) => { if (!cancelled) setRemote(r) })
        .catch(() => { if (!cancelled) setRemote(null) })
    }
    read()
    const timer = window.setInterval(read, BALANCE_REFRESH_MS)
    window.addEventListener('focus', read)
    return () => { cancelled = true; window.clearInterval(timer); window.removeEventListener('focus', read) }
  }, [])
  return resolveStatusBalance(remote, account)
}

function useUpdateInfo() {
  const [info, setInfo] = React.useState<UpdateInfo | null>(null)
  const [checking, setChecking] = React.useState(false)
  React.useEffect(() => {
    const api = window.electronAPI
    if (!api?.getUpdateInfo) return
    let cancelled = false
    void api.getUpdateInfo().then((i) => { if (!cancelled) setInfo(i ?? null) }).catch(() => {})
    const off = api.onUpdateAvailable?.((i) => { if (!cancelled) setInfo(i) })
    return () => { cancelled = true; off?.() }
  }, [])
  const check = React.useCallback(async () => {
    const api = window.electronAPI
    if (!api?.checkForUpdates) return
    setChecking(true)
    try { setInfo(await api.checkForUpdates()) } catch { /* keep the last known info */ } finally { setChecking(false) }
  }, [])
  return { info, checking, check }
}

function Sep() { return <span aria-hidden className={sepCls} /> }

function Counter({ icon: Icon, label, value, onClick, testId, accent }: {
  icon: typeof Bot; label: string; value: number | null; onClick: () => void; testId: string; accent?: boolean
}) {
  if (value == null) return null
  return (
    <button type="button" data-testid={testId} className={itemCls} onClick={onClick} title={label} aria-label={`${label}: ${value}`}>
      <Icon className="size-3 shrink-0" />
      <span className="hidden truncate xl:inline">{label}</span>
      <span className={cn(numCls, accent && value > 0 && 'text-accent')}>{value}</span>
    </button>
  )
}

export function StatusBar({ account }: { account: RoxAccountSnapshot | null }) {
  const { t } = useTranslation()
  const shell = useOptionalAppShellContext()
  const transport = useTransportConnectionState()
  const model = buildStatusBarModel({ transportMode: transport?.mode, transportStatus: transport?.status })
  const balance = useRoxBalance(account)
  const update = useUpdateInfo()
  const [reconnecting, setReconnecting] = React.useState(false)

  const workspace = shell?.activeWorkspaceId ? shell.workspaces.find((w) => w.id === shell.activeWorkspaceId) ?? null : null
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const sessionStats = React.useMemo(() => {
    let sessions = 0
    let agents = 0
    for (const meta of metaMap.values()) {
      if (meta.hidden || meta.isArchived || isInternalAgentSession(meta)) continue
      if (!isHomeSessionInWorkspace(meta, workspace?.id, workspace?.remoteServer?.remoteWorkspaceId)) continue
      sessions += 1
      if (meta.isProcessing) agents += 1
    }
    return { sessions, agents }
  }, [metaMap, workspace])
  const tasks = useWorkspaceTaskCount(workspace?.id)
  const inbox = useInboxItems({ withRemote: false })
  const inboxOpen = inbox.counts.all
  const latest = inbox.items.find((item) => !inbox.state.done[item.id] && !inbox.state.snoozed[item.id])

  const reconnect = async () => {
    const api = window.electronAPI
    if (!api?.reconnectTransport) return
    setReconnecting(true)
    try { await api.reconnectTransport() } catch { /* the state hook reports the failure */ } finally { setReconnecting(false) }
  }

  // Current model: native runtime summary or the workspace default LLM connection.
  const connections = (shell?.llmConnections ?? []).filter((c) => c.isAuthenticated)
  const runtime = shell?.runtimeSummary
  const currentSlug = shell?.workspaceDefaultLlmConnection ?? runtime?.slug
  const currentConn = connections.find((c) => c.slug === currentSlug)
  const modelName = runtime?.defaultModel
    ? runtime.models?.find((m) => m.id === runtime.defaultModel)?.name ?? runtime.defaultModel
    : currentConn ? `${currentConn.defaultModel ?? currentConn.name}` : null
  const [pickBusy, setPickBusy] = React.useState(false)
  const pickConnection = async (slug: string) => {
    const api = window.electronAPI
    if (!api) return
    setPickBusy(true)
    try {
      const result = workspace?.id && api.setWorkspaceDefaultLlmConnection
        ? await api.setWorkspaceDefaultLlmConnection(workspace.id, slug)
        : await api.setDefaultLlmConnection(slug)
      if (result?.success) await shell?.refreshLlmConnections()
    } finally { setPickBusy(false) }
  }

  const syncLabel = reconnecting || transport?.status === 'connecting' || transport?.status === 'reconnecting'
    ? t('statusBar.syncing')
    : model.syncOk ? t('workbench.status.syncOk') : t('statusBar.syncFailed')
  const version = update.info?.currentVersion ?? null
  const updateReady = Boolean(update.info?.available && update.info.latestVersion)

  return (
    <div
      data-slot="status"
      data-testid="compact-status-bar"
      className="chrome-strip chrome-label-sm label-tracking flex shrink-0 items-center justify-between gap-1 px-1.5 text-muted-foreground"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" data-testid="status-bar-workspace" className={itemCls} title={t('statusBar.connection')}>
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', model.workspaceMode === 'offline' ? 'bg-destructive' : model.syncOk ? 'bg-success' : 'bg-info')} />
              <span className={cn('truncate', model.workspaceMode === 'offline' && 'text-destructive')}>
                {workspace?.name ? `${workspace.name} · ` : ''}{workspaceModeLabel(model.workspaceMode, t)}
              </span>
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className={popCls}>
            <div className="mb-1 font-semibold text-foreground">{workspace?.name ?? t('statusBar.connection')}</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
              <dt>{t('statusBar.mode')}</dt><dd className="text-foreground">{workspaceModeLabel(model.workspaceMode, t)}</dd>
              <dt>{t('statusBar.state')}</dt><dd className="text-foreground">{syncLabel}</dd>
              {transport?.url ? <><dt>{t('statusBar.server')}</dt><dd className="truncate text-foreground" title={transport.url}>{transport.url}</dd></> : null}
              {transport?.attempt ? <><dt>{t('statusBar.attempt')}</dt><dd className="numeric text-foreground">{transport.attempt}</dd></> : null}
              {transport?.lastError ? <><dt>{t('statusBar.error')}</dt><dd className="truncate text-destructive">{transport.lastError.message}</dd></> : null}
            </dl>
            <div className="mt-2 flex gap-1">
              <button type="button" className={cn(itemCls, 'border border-foreground/10')} onClick={() => void reconnect()} disabled={reconnecting}>
                <RefreshCw className={cn('size-3', reconnecting && 'animate-spin')} />{t('statusBar.reconnect')}
              </button>
              <button type="button" className={cn(itemCls, 'border border-foreground/10')} onClick={() => navigate(routes.view.settings('workspace'))}>
                {t('statusBar.workspaceSettings')}
              </button>
            </div>
          </PopoverContent>
        </Popover>
        <button
          type="button"
          data-testid="status-bar-sync"
          className={cn(itemCls, !model.syncOk && 'text-destructive')}
          onClick={() => void reconnect()}
          disabled={reconnecting}
          title={t('statusBar.retrySync')}
        >
          <RefreshCw className={cn('size-3 shrink-0', reconnecting && 'animate-spin')} />
          <span className="truncate">{syncLabel}</span>
        </button>
        <Sep />
        <Counter testId="status-bar-sessions" icon={MessageSquare} label={t('dashboard.sessions')} value={sessionStats.sessions} onClick={() => navigate(routes.view.allSessions())} />
        <Counter testId="status-bar-agents" icon={Bot} label={t('dashboard.activeAgents')} value={sessionStats.agents} accent onClick={() => navigate(routes.view.screen('agents'))} />
        <Counter testId="status-bar-tasks" icon={ListTodo} label={t('statusBar.tasks')} value={tasks} onClick={() => navigate(routes.view.tasks())} />
        <Counter testId="status-bar-inbox" icon={Inbox} label={t('statusBar.inbox')} value={inboxOpen} onClick={() => navigate(routes.view.inbox())} />
      </div>

      <div className="flex min-w-0 items-center justify-end gap-0.5">
        {modelName || connections.length > 0 ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" data-testid="status-bar-model" className={itemCls} title={t('statusBar.model')}>
                <Cpu className="size-3 shrink-0" />
                <span className="max-w-[160px] truncate">{modelName ?? t('statusBar.pickModel')}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className={popCls}>
              <div className="mb-1 font-semibold text-foreground">{t('statusBar.model')}</div>
              {connections.length > 0 ? (
                <ul className="flex flex-col gap-0.5">
                  {connections.map((c) => (
                    <li key={c.slug}>
                      <button
                        type="button"
                        disabled={pickBusy}
                        onClick={() => void pickConnection(c.slug)}
                        className={cn(itemCls, 'w-full justify-between', c.slug === currentSlug && 'bg-foreground/[0.06] text-foreground')}
                      >
                        <span className="truncate">{c.name}</span>
                        <span className="truncate opacity-70">{c.defaultModel ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : runtime?.models?.length ? (
                <div className="text-muted-foreground">{runtime.providerType}</div>
              ) : null}
              <button type="button" className={cn(itemCls, 'mt-1.5 border border-foreground/10')} onClick={() => navigate(routes.view.settings('ai'))}>
                {t('statusBar.modelSettings')}
              </button>
            </PopoverContent>
          </Popover>
        ) : null}
        {balance != null ? (
          <button
            type="button"
            data-testid="status-bar-balance"
            className={itemCls}
            onClick={() => navigate(routes.view.settings('account'))}
            title={t('profile.balanceLabel')}
          >
            <Wallet className="size-3 shrink-0" />
            <span className="numeric">{t('profile.balanceLabel')} {t('profile.balance', { amount: balance })}</span>
          </button>
        ) : null}
        <Sep />
        <button
          type="button"
          data-testid="status-bar-notifications"
          className={itemCls}
          onClick={() => navigate(routes.view.inbox())}
          title={t('statusBar.notifications')}
          aria-label={`${t('statusBar.notifications')}: ${inboxOpen}`}
        >
          <Bell className="size-3 shrink-0" />
          <span className="hidden max-w-[220px] truncate lg:inline">{latest?.title ?? t('statusBar.noEvents')}</span>
          {inboxOpen > 0 ? <span className={cn(numCls, 'rounded-full bg-accent/15 px-1 text-accent')}>{inboxOpen > 99 ? '99+' : inboxOpen}</span> : null}
        </button>
        {version ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" data-testid="status-bar-version" className={cn(itemCls, updateReady && 'text-accent')} title={t('statusBar.updates')}>
                <span className="numeric">{t('statusBar.version', { version })}</span>
                {updateReady ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className={popCls}>
              <div className="mb-1 font-semibold text-foreground">{t('statusBar.version', { version })}</div>
              <div className="text-muted-foreground">
                {update.checking ? t('statusBar.checking')
                  : update.info?.error ? update.info.error
                  : updateReady ? t('statusBar.updateAvailable', { version: update.info?.latestVersion })
                  : t('statusBar.upToDate')}
              </div>
              <div className="mt-2 flex gap-1">
                <button type="button" className={cn(itemCls, 'border border-foreground/10')} disabled={update.checking} onClick={() => void update.check()}>
                  <RefreshCw className={cn('size-3', update.checking && 'animate-spin')} />{t('statusBar.checkUpdates')}
                </button>
                {updateReady ? (
                  <button
                    type="button"
                    className={cn(itemCls, 'border border-accent/40 text-accent')}
                    onClick={() => {
                      const api = window.electronAPI
                      if (update.info?.updateMode === 'manual' && update.info.releaseUrl) void api?.openUrl(update.info.releaseUrl)
                      else void api?.installUpdate()
                    }}
                  >
                    {t('statusBar.install')}
                  </button>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  )
}
