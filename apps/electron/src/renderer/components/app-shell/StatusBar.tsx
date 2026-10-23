/**
 * Functional bottom status bar (demo.rox.one parity).
 *
 * A ~24px strip at the bottom of the shell. Every item is a button backed by
 * real data, nothing is a placeholder:
 *  left  — workspace/connection (popover with transport details + reconnect),
 *          sync state (click retries), sessions / active agents / tasks today /
 *          inbox counters (click opens the section);
 *  right — current model (popover picker over the real LLM connections),
 *          Rox balance from api.rox.one (hidden when unavailable), notifications (opt-in)
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
import { usePersonalTasks } from '@/lib/extra-screens/use-rox-sources'
import { matchesProjection } from '@rox/core/tasks/personal'
import { useInboxBlockingCount, useInboxItems } from '@/hooks/useInboxItems'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { isInternalAgentSession } from '@rox/shared/sessions/internal-prompts'
import { isHomeSessionInWorkspace } from '@/platform/home-model'
import { navigate, routes } from '@/lib/navigate'
import { cn } from '@/lib/utils'
import { isActive, type InboxItem, type InboxState } from '@/pages/inbox/inbox-model'
import { buildStatusBarModel, type WorkspaceRuntimeMode } from '@/platform/status-model'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { RoxAccountSnapshot } from '@rox/shared/auth'
import type { UpdateInfo } from '@rox/shared/protocol'
import { useDictationSession } from '@/components/app-shell/input/voice-dictation-state'
import { useStatusBarItems, type StatusBarItem } from '@/lib/status-bar-items'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@rox/ui/tooltip'

/** First inbox item that is neither done nor still snoozed (expired snoozes count as active, like counts.all). */
export function pickLatestInboxItem<T extends InboxItem>(items: readonly T[], state: InboxState, now: number): T | undefined {
  return items.find((item) => isActive(state, item, now))
}

type DefaultConnectionApi = {
  setWorkspaceDefaultLlmConnection?: (workspaceId: string, slug: string) => Promise<{ success?: boolean } | undefined | null>
  setDefaultLlmConnection: (slug: string) => Promise<{ success?: boolean } | undefined | null>
}

/**
 * Persist the picked model connection and refresh the list. Never rejects: an
 * IPC failure is logged and reported as `false`, so the fire-and-forget onClick
 * cannot raise an unhandled rejection.
 */
export async function applyDefaultConnection(
  api: DefaultConnectionApi,
  workspaceId: string | undefined,
  slug: string,
  refresh?: () => Promise<unknown> | unknown,
): Promise<boolean> {
  try {
    const result = workspaceId && api.setWorkspaceDefaultLlmConnection
      ? await api.setWorkspaceDefaultLlmConnection(workspaceId, slug)
      : await api.setDefaultLlmConnection(slug)
    if (!result?.success) return false
    await refresh?.()
    return true
  } catch (error) {
    console.warn('[StatusBar] failed to switch model connection', error)
    return false
  }
}

/** CSS var so the bar follows `data-density`. */
const STATUS_BAR_HEIGHT = 'var(--chrome-status-height)'
const BALANCE_REFRESH_MS = 60_000

const itemCls = 'inline-flex h-[18px] min-w-0 items-center gap-1 rounded-xs px-1.5 text-muted-foreground transition-colors hover:bg-[var(--state-hover)] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none'
const numCls = 'numeric font-semibold text-foreground'
const sepCls = 'h-3 w-px shrink-0 bg-border-subtle'
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

/** Tooltip for status-bar buttons (rox/prefer-primitives: no native title on buttons). */
function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

function Sep() { return <span aria-hidden className={sepCls} /> }

function Counter({ icon: Icon, label, title, value, onClick, testId, accent }: {
  icon: typeof Bot; label: string; title?: string; value: number | null; onClick: () => void; testId: string; accent?: boolean
}) {
  if (value == null) return null
  return (
    <button type="button" data-testid={testId} className={itemCls} onClick={onClick} title={title ?? label} aria-label={`${title ?? label}: ${value}`}>
      <Icon className="icon-status shrink-0" />
      <span className="hidden truncate xl:inline">{label}</span>
      <span className={cn(numCls, accent && value > 0 && 'text-accent')}>{value}</span>
    </button>
  )
}

/**
 * Update action from the version popover. Manual-mode builds open the release page; otherwise the
 * update installs in place. Never rejects: an IPC failure is logged, not left unhandled.
 */
export async function installOrOpenUpdate(info: UpdateInfo | null): Promise<void> {
  const api = window.electronAPI
  if (!api) return
  try {
    if (info?.updateMode === 'manual' && info.releaseUrl) await api.openUrl(info.releaseUrl)
    else await api.installUpdate()
  } catch (error) {
    console.warn('[StatusBar] failed to install the update', error)
  }
}

// Data-backed items are separate components so their hooks (IPC, polling) only run while the
// item is enabled in Settings → Appearance → Status bar.

/** demo.rox.one parity: open personal tasks that land in «Сегодня» (due/started today or overdue). */
function TasksCounter() {
  const { t } = useTranslation()
  const personalTasks = usePersonalTasks()
  const [dayTick, setDayTick] = React.useState(() => Date.now())
  React.useEffect(() => {
    const timer = window.setInterval(() => setDayTick(Date.now()), BALANCE_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])
  const tasks = React.useMemo(
    () => personalTasks.filter((task) => matchesProjection(task, dayTick, 'today')).length,
    [personalTasks, dayTick],
  )
  return <Counter testId="status-bar-tasks" icon={ListTodo} label={t('statusBar.tasks')} title={t('statusBar.tasksToday')} value={tasks} onClick={() => navigate(routes.view.tasks())} />
}

/** Inbox counter: items that block you (needs a reply/approval), as before #7. */
function InboxCounter() {
  const { t } = useTranslation()
  const blocking = useInboxBlockingCount()
  return <Counter testId="status-bar-inbox" icon={Inbox} label={t('statusBar.inbox')} value={blocking} onClick={() => navigate(routes.view.inbox())} />
}

/** Latest inbox event + open count. Opt-in (hidden by default): the titlebar bell covers notifications. */
function NotificationsItem() {
  const { t } = useTranslation()
  const inbox = useInboxItems({ withRemote: false })
  const inboxOpen = inbox.counts.all
  const latest = pickLatestInboxItem(inbox.items, inbox.state, inbox.now ?? Date.now())
  return (
    <button
      type="button"
      data-testid="status-bar-notifications"
      className={itemCls}
      onClick={() => navigate(routes.view.inbox())}
      aria-label={`${t('statusBar.notifications')}: ${inboxOpen}`}
    >
      <Bell className="icon-status shrink-0" />
      <span className="hidden max-w-[220px] truncate lg:inline">{latest?.title ?? t('statusBar.noEvents')}</span>
      {inboxOpen > 0 ? <span className={cn(numCls, 'rounded-full bg-accent/15 px-1 text-accent')}>{inboxOpen > 99 ? '99+' : inboxOpen}</span> : null}
    </button>
  )
}

export function StatusBar({ account }: { account: RoxAccountSnapshot | null }) {
  const { t } = useTranslation()
  const shell = useOptionalAppShellContext()
  const transport = useTransportConnectionState()
  const items = useStatusBarItems()
  const show = (id: StatusBarItem) => items.includes(id)
  const dictation = useDictationSession()
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
  // The selected connection wins so a pick in the popover is reflected immediately.
  const modelName = currentConn
    ? currentConn.defaultModel ?? currentConn.name
    : runtime?.defaultModel
      ? runtime.models?.find((m) => m.id === runtime.defaultModel)?.name ?? runtime.defaultModel
      : null
  const [pickBusy, setPickBusy] = React.useState(false)
  const pickConnection = async (slug: string) => {
    const api = window.electronAPI
    if (!api) return
    setPickBusy(true)
    try {
      await applyDefaultConnection(api, workspace?.id, slug, shell?.refreshLlmConnections)
    } finally { setPickBusy(false) }
  }

  const syncLabel = reconnecting || transport?.status === 'connecting' || transport?.status === 'reconnecting'
    ? t('statusBar.syncing')
    : model.syncOk ? t('workbench.status.syncOk') : t('statusBar.syncFailed')
  const version = update.info?.currentVersion ?? null
  const updateReady = Boolean(update.info?.available && update.info.latestVersion)

  return (
    <TooltipProvider>
    <div
      data-slot="status"
      data-testid="compact-status-bar"
      className="chrome-strip chrome-label-sm leading-none label-tracking flex shrink-0 items-center justify-between gap-1 px-1.5 text-muted-foreground"
      style={{ height: STATUS_BAR_HEIGHT }}
    >
      <div className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        {show('workspace') && (<Popover>
          <Tip label={t('statusBar.connection')}><PopoverTrigger asChild>
            <button type="button" data-testid="status-bar-workspace" className={itemCls}>
              <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', model.workspaceMode === 'offline' ? 'bg-destructive' : model.syncOk ? 'bg-success' : 'bg-info')} />
              <span className={cn('truncate', model.workspaceMode === 'offline' && 'text-destructive')}>
                {workspace?.name ? `${workspace.name} · ` : ''}{workspaceModeLabel(model.workspaceMode, t)}
              </span>
            </button>
          </PopoverTrigger></Tip>
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
              <button type="button" className={cn(itemCls, 'border border-border-subtle')} onClick={() => void reconnect()} disabled={reconnecting}>
                <RefreshCw className={cn('icon-status', reconnecting && 'animate-spin')} />{t('statusBar.reconnect')}
              </button>
              <button type="button" className={cn(itemCls, 'border border-border-subtle')} onClick={() => navigate(routes.view.settings('workspace'))}>
                {t('statusBar.workspaceSettings')}
              </button>
            </div>
          </PopoverContent>
        </Popover>)}
        {show('sync') && (<Tip label={t('statusBar.retrySync')}><button
          type="button"
          data-testid="status-bar-sync"
          className={cn(itemCls, !model.syncOk && 'text-destructive')}
          onClick={() => void reconnect()}
          disabled={reconnecting}
        >
          <RefreshCw className={cn('icon-status shrink-0', reconnecting && 'animate-spin')} />
          <span className="truncate">{syncLabel}</span>
        </button></Tip>)}
        <Sep />
        {show('sessions') && <Counter testId="status-bar-sessions" icon={MessageSquare} label={t('dashboard.sessions')} value={sessionStats.sessions} onClick={() => navigate(routes.view.allSessions())} />}
        {show('agents') && <Counter testId="status-bar-agents" icon={Bot} label={t('dashboard.activeAgents')} value={sessionStats.agents} accent onClick={() => navigate(routes.view.screen('agents'))} />}
        {show('tasks') && <TasksCounter />}
        {show('inbox') && <InboxCounter />}
        {show('dictation') && dictation.active && (
          <span data-testid="status-bar-dictation" role="status" className="flex items-center gap-1 px-1.5 text-accent">
            <span aria-hidden className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
            {t('statusBar.dictating')}
          </span>
        )}
      </div>

      <div className="flex min-w-0 items-center justify-end gap-0.5">
        {show('model') && (modelName || connections.length > 0) ? (
          <Popover>
            <Tip label={t('statusBar.model')}><PopoverTrigger asChild>
              <button type="button" data-testid="status-bar-model" className={itemCls}>
                <Cpu className="icon-status shrink-0" />
                <span className="max-w-[160px] truncate">{modelName ?? t('statusBar.pickModel')}</span>
              </button>
            </PopoverTrigger></Tip>
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
                        className={cn(itemCls, 'w-full justify-between', c.slug === currentSlug && 'bg-surface-selected text-foreground')}
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
              <button type="button" className={cn(itemCls, 'mt-1.5 border border-border-subtle')} onClick={() => navigate(routes.view.settings('ai'))}>
                {t('statusBar.modelSettings')}
              </button>
            </PopoverContent>
          </Popover>
        ) : null}
        {show('balance') && balance != null ? (
          <Tip label={t('profile.balanceLabel')}><button
            type="button"
            data-testid="status-bar-balance"
            className={itemCls}
            onClick={() => navigate(routes.view.settings('account'))}
          >
            <Wallet className="icon-status shrink-0" />
            <span className="numeric">{t('profile.balanceLabel')} {t('profile.balance', { amount: balance })}</span>
          </button></Tip>
        ) : null}
        <Sep />
        {show('notifications') && <NotificationsItem />}
        {show('version') && version ? (
          <Popover>
            <Tip label={t('statusBar.updates')}><PopoverTrigger asChild>
              <button type="button" data-testid="status-bar-version" className={cn(itemCls, updateReady && 'text-accent')}>
                <span className="numeric">{t('statusBar.version', { version })}</span>
                {updateReady ? <span aria-hidden className="size-1.5 rounded-full bg-accent" /> : null}
              </button>
            </PopoverTrigger></Tip>
            <PopoverContent side="top" align="end" className={popCls}>
              <div className="mb-1 font-semibold text-foreground">{t('statusBar.version', { version })}</div>
              <div className="text-muted-foreground">
                {update.checking ? t('statusBar.checking')
                  : update.info?.error ? update.info.error
                  : updateReady ? t('statusBar.updateAvailable', { version: update.info?.latestVersion })
                  : t('statusBar.upToDate')}
              </div>
              <div className="mt-2 flex gap-1">
                <button type="button" className={cn(itemCls, 'border border-border-subtle')} disabled={update.checking} onClick={() => void update.check()}>
                  <RefreshCw className={cn('icon-status', update.checking && 'animate-spin')} />{t('statusBar.checkUpdates')}
                </button>
                {updateReady ? (
                  <button
                    type="button"
                    className={cn(itemCls, 'border border-accent/40 text-accent')}
                    onClick={() => void installOrOpenUpdate(update.info)}
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
    </TooltipProvider>
  )
}
