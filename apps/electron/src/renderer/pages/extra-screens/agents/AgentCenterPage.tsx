/**
 * «Центр агентов» — every agent and background run on one screen: waiting for
 * the user, running now, stuck, cloud runs, automations, and authoritative
 * workspace budget status, with stop / pause controls.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { parseAutomationsConfig } from '@/components/automations/types'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import { loadWorkspaceJson, saveWorkspaceJson, subscribeWorkspaceJson } from '@/lib/extra-screens/storage'
import type { AgentBudgetSnapshot } from '@rox/shared/agent'
import { cn } from '@/lib/utils'
import { Card, CardTitle, Chip, ScreenButton, ScreenDetail, ScreenHeader, ScreenRoot, TextField } from '../ui'
import {
  buildAgentCenter,
  formatAgo,
  formatUsd,
  normalizeCloudRuns,
  type CenterAutomation,
  type CenterCloudRun,
  type CenterSession,
} from './agent-center-model'
import { useWorkspaceSessions, sessionTitle } from '@/lib/extra-screens/use-rox-sources'
import { getSessionTitle } from '@/utils/session'

const NS = 'agent-center'

interface CenterSettings {
  /** Automations paused from this screen (for «Возобновить приостановленные»). */
  pausedByCenter: string[]
}

function normalizeSettings(raw: unknown): CenterSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { pausedByCenter: Array.isArray(r.pausedByCenter) ? r.pausedByCenter.filter((x): x is string => typeof x === 'string') : [] }
}

function useCloudRuns(): { enabled: boolean; runs: CenterCloudRun[]; refresh: () => void } {
  const [state, setState] = useState<{ enabled: boolean; runs: CenterCloudRun[] }>({ enabled: false, runs: [] })
  const refresh = useCallback(() => {
    const api = window.electronAPI
    if (typeof api?.listCloudRuns !== 'function') return
    api.listCloudRuns().then((raw) => setState(normalizeCloudRuns(raw)), () => setState({ enabled: false, runs: [] }))
  }, [])
  useEffect(() => {
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => window.clearInterval(timer)
  }, [refresh])
  return { ...state, refresh }
}

function useCenterAutomations(workspaceId: string | null): { automations: CenterAutomation[]; available: boolean } {
  const [state, setState] = useState<{ automations: CenterAutomation[]; available: boolean }>({ automations: [], available: false })
  useEffect(() => {
    const api = window.electronAPI
    if (!workspaceId || typeof api?.getAutomations !== 'function') return
    let cancelled = false
    const load = async () => {
      try {
        const json = await api.getAutomations(workspaceId)
        const items = json ? parseAutomationsConfig(json) : []
        let last: Record<string, number> = {}
        try { last = await api.getAutomationLastExecuted(workspaceId) } catch { /* no history */ }
        if (cancelled) return
        setState({
          available: true,
          automations: items.map((item) => ({
            id: item.id,
            name: item.name,
            event: item.event,
            matcherIndex: item.matcherIndex,
            enabled: item.enabled,
            cron: item.cron,
            lastExecutedAt: last[item.id] ?? item.lastExecutedAt,
          })),
        })
      } catch {
        if (!cancelled) setState({ automations: [], available: false })
      }
    }
    void load()
    const off = typeof api.onAutomationsChanged === 'function' ? api.onAutomationsChanged(() => { void load() }) : undefined
    return () => { cancelled = true; off?.() }
  }, [workspaceId])
  return state
}

export default function AgentCenterPage(_props: { itemId: string | null }) {
  const { t, i18n } = useTranslation()
  const language: 'ru' | 'en' = i18n.language.startsWith('ru') ? 'ru' : 'en'
  const workspace = useActiveWorkspace()
  const workspaceId = workspace?.id ?? null
  const { pendingPermissions, pendingCredentials } = useAppShellContext()
  const sessions = useWorkspaceSessions(workspaceId)
  const cloud = useCloudRuns()
  const { automations, available: automationsAvailable } = useCenterAutomations(workspaceId)
  const [settings, setSettings] = useState<CenterSettings>(() => loadWorkspaceJson(NS, workspaceId, normalizeSettings))
  const [budget, setBudget] = useState<AgentBudgetSnapshot | null>(null)
  const [budgetLoading, setBudgetLoading] = useState(true)
  const [budgetDraft, setBudgetDraft] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = loadWorkspaceJson(NS, workspaceId, normalizeSettings)
    setSettings(next)
    return subscribeWorkspaceJson(NS, workspaceId, () => setSettings(loadWorkspaceJson(NS, workspaceId, normalizeSettings)))
  }, [workspaceId])
  useEffect(() => {
    let cancelled = false
    const api = window.electronAPI
    setBudget(null)
    setBudgetLoading(true)
    if (!workspaceId || typeof api?.getSessionBudget !== 'function') {
      setBudgetLoading(false)
      return
    }
    api.getSessionBudget(workspaceId).then((snapshot) => {
      if (!cancelled) {
        setBudget(snapshot)
        setBudgetDraft(snapshot.limitUsd == null ? '' : String(snapshot.limitUsd))
      }
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    }).finally(() => {
      if (!cancelled) setBudgetLoading(false)
    })
    return () => { cancelled = true }
  }, [workspaceId])
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  const saveSettings = (next: CenterSettings) => {
    setSettings(next)
    saveWorkspaceJson(NS, workspaceId, next)
  }

  const center = useMemo(() => buildAgentCenter({
    sessions: sessions.map((s): CenterSession => ({
      id: s.id,
      name: sessionTitle(s),
      isProcessing: s.isProcessing,
      lastMessageAt: s.lastMessageAt,
      createdAt: s.createdAt,
      permissionMode: s.permissionMode,
    })),
    pendingPermissions: new Map([...pendingPermissions].map(([id, list]) => [id, list.length])),
    pendingCredentials: new Map([...pendingCredentials].map(([id, list]) => [id, list.length])),
    cloudRuns: cloud.runs,
    automations,
    now,
    budget,
  }), [sessions, pendingPermissions, pendingCredentials, cloud.runs, automations, now, budget])

  const withBusy = async (key: string, fn: () => Promise<unknown>) => {
    setBusy((prev) => new Set(prev).add(key))
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(key); return next })
    }
  }

  const stopSession = (id: string) => withBusy(`s:${id}`, () => window.electronAPI.cancelProcessing(id))
  const stopAll = () => withBusy('all', async () => {
    for (const s of [...center.running, ...center.stuck]) await window.electronAPI.cancelProcessing(s.id)
  })
  const cancelCloud = (id: string) => withBusy(`c:${id}`, async () => { await window.electronAPI.cancelCloudRun(id); cloud.refresh() })
  const setAutomation = (a: CenterAutomation, enabled: boolean) => withBusy(`a:${a.id}`, async () => {
    if (!workspaceId) return
    await window.electronAPI.setAutomationEnabled(workspaceId, a.event, a.matcherIndex, enabled)
    const paused = new Set(settings.pausedByCenter)
    if (enabled) paused.delete(a.id)
    else paused.add(a.id)
    saveSettings({ ...settings, pausedByCenter: [...paused] })
  })
  const pauseAll = () => withBusy('pause-all', async () => {
    if (!workspaceId) return
    const ids: string[] = []
    for (const a of center.automationsEnabled) {
      await window.electronAPI.setAutomationEnabled(workspaceId, a.event, a.matcherIndex, false)
      ids.push(a.id)
    }
    saveSettings({ ...settings, pausedByCenter: [...new Set([...settings.pausedByCenter, ...ids])] })
  })
  const resumePaused = () => withBusy('resume', async () => {
    if (!workspaceId) return
    for (const a of center.automationsPaused.filter((x) => settings.pausedByCenter.includes(x.id))) {
      await window.electronAPI.setAutomationEnabled(workspaceId, a.event, a.matcherIndex, true)
    }
    saveSettings({ ...settings, pausedByCenter: [] })
  })

  const commitBudget = () => withBusy('budget', async () => {
    if (!workspaceId) return
    const text = budgetDraft.trim().replace(',', '.')
    const limitUsd = text === '' ? null : Number(text)
    if (limitUsd !== null && (!Number.isFinite(limitUsd) || limitUsd <= 0)) {
      throw new Error(t('extraScreens.agents.budgetInvalid'))
    }
    const snapshot = await window.electronAPI.setSessionBudget(workspaceId, { limitUsd })
    setBudget(snapshot)
    setBudgetDraft(snapshot.limitUsd == null ? '' : String(snapshot.limitUsd))
  })

  const openSession = (id: string) => navigate(routes.view.allSessions(id))
  const ago = (ts?: number) => (ts ? formatAgo(now - ts, language) : '—')
  const pausedHere = center.automationsPaused.filter((a) => settings.pausedByCenter.includes(a.id))
  const nothingActive = center.running.length + center.stuck.length + center.waiting.length + center.cloudActive.length === 0

  return (
    <ScreenRoot>
      <ScreenDetail className="px-0 py-0">
        <ScreenHeader
          title={t('extraScreens.agents.title')}
          actions={(center.running.length + center.stuck.length) > 0
            ? <ScreenButton variant="danger" disabled={busy.has('all')} onClick={() => { void stopAll() }}>{t('extraScreens.agents.stopAll')}</ScreenButton>
            : undefined}
        />
        <div className="max-w-[1100px] px-4 pb-6">
          {error && <div className="pb-2 text-destructive">{error}</div>}
          <div className="grid grid-cols-4 gap-2">
            <Stat label={t('extraScreens.agents.running')} value={String(center.running.length + center.cloudActive.length)} />
            <Stat label={t('extraScreens.agents.waiting')} value={String(center.waiting.length)} tone={center.waiting.length ? 'warn' : undefined} />
            <Stat label={t('extraScreens.agents.stuck')} value={String(center.stuck.length)} tone={center.stuck.length ? 'err' : undefined} />
            <Stat
              label={t('extraScreens.agents.costToday')}
              value={center.budget?.limitUsd == null ? '—' : formatUsd(center.budget.spentUsd)}
              sub={center.budget?.limitUsd == null ? undefined : t('extraScreens.agents.ofBudget', { budget: formatUsd(center.budget.limitUsd) })}
              tone={center.budget?.exhausted ? 'err' : undefined}
            />
          </div>

          <Card accent={!!center.budget?.exhausted}>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{t('extraScreens.agents.budgetTitle')}</CardTitle>
              <span className="flex-1" />
              <span className="text-[12px] text-muted-foreground">{t('extraScreens.agents.budgetLabel')}</span>
              <fieldset disabled={budgetLoading || busy.has('budget')}><TextField value={budgetDraft} onChange={setBudgetDraft} onEnter={commitBudget} onBlur={commitBudget} placeholder="$" className="h-7 w-[90px]" ariaLabel={t('extraScreens.agents.budgetLabel')} /></fieldset>
            </div>
            {center.budget?.limitUsd != null && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.08]" role="progressbar" aria-valuenow={Math.round(Math.min(100, ((center.budget.spentUsd + center.budget.reservedUsd) / center.budget.limitUsd) * 100))} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn('h-full', center.budget.exhausted ? 'bg-destructive' : 'bg-accent')} style={{ width: `${Math.min(100, ((center.budget.spentUsd + center.budget.reservedUsd) / center.budget.limitUsd) * 100)}%` }} />
              </div>
            )}
            <div className="mt-1.5 text-[12px] text-muted-foreground">
              {budgetLoading
                ? t('extraScreens.agents.budgetHint')
                : center.budget?.limitUsd != null && center.budget.unresolvedUsd > 0
                  ? t('extraScreens.agents.budgetUnknown')
                  : center.budget?.exhausted
                    ? t('extraScreens.agents.budgetExhausted')
                    : center.budget?.limitUsd != null
                      ? t('extraScreens.agents.budgetEnforced')
                      : t('extraScreens.agents.budgetHint')}
            </div>
            {center.budget?.limitUsd != null && (
              <div className="mt-1 text-[12px] text-muted-foreground">
                {t('extraScreens.agents.budgetRemaining')}: {center.budget.remainingUsd == null ? '—' : formatUsd(center.budget.remainingUsd)} · {t('extraScreens.agents.budgetReserved')}: {formatUsd(center.budget.reservedUsd)}
              </div>
            )}
          </Card>

          {nothingActive && (
            <div className="mt-4 rounded-[8px] bg-foreground/[0.03] px-4 py-3 text-muted-foreground" role="status">{t('extraScreens.agents.allQuiet')}</div>
          )}

          {center.waiting.length > 0 && (
            <Section title={t('extraScreens.agents.waiting')} count={center.waiting.length}>
              {center.waiting.map(({ session, permissions, credentials }) => (
                <Row key={session.id} title={getSessionTitle(session)} meta={[permissions ? t('extraScreens.agents.permissions', { n: permissions }) : null, credentials ? t('extraScreens.agents.credentials', { n: credentials }) : null].filter(Boolean).join(' · ')}>
                  <Chip tone="warn">{t('extraScreens.agents.needsYou')}</Chip>
                  <ScreenButton variant="primary" onClick={() => openSession(session.id)}>{t('extraScreens.agents.answer')}</ScreenButton>
                </Row>
              ))}
            </Section>
          )}

          {center.running.length > 0 && (
            <Section title={t('extraScreens.agents.runningNow')} count={center.running.length}>
              {center.running.map((s) => (
                <Row key={s.id} title={s.name} meta={[t('extraScreens.agents.lastEvent', { ago: ago(s.lastMessageAt ?? s.createdAt) }), s.permissionMode].filter(Boolean).join(' · ')}>
                  <ScreenButton onClick={() => openSession(s.id)}>{t('extraScreens.radar.open')}</ScreenButton>
                  <ScreenButton variant="danger" disabled={busy.has(`s:${s.id}`)} onClick={() => { void stopSession(s.id) }}>{t('extraScreens.agents.stop')}</ScreenButton>
                </Row>
              ))}
            </Section>
          )}

          {center.stuck.length > 0 && (
            <Section title={t('extraScreens.agents.stuck')} count={center.stuck.length} hint={t('extraScreens.agents.stuckHint')}>
              {center.stuck.map((s) => (
                <Row key={s.id} title={s.name} meta={t('extraScreens.agents.silentFor', { ago: ago(s.lastMessageAt ?? s.createdAt) })}>
                  <Chip tone="err">{t('extraScreens.agents.stuckChip')}</Chip>
                  <ScreenButton onClick={() => openSession(s.id)}>{t('extraScreens.radar.open')}</ScreenButton>
                  <ScreenButton variant="danger" disabled={busy.has(`s:${s.id}`)} onClick={() => { void stopSession(s.id) }}>{t('extraScreens.agents.stop')}</ScreenButton>
                </Row>
              ))}
            </Section>
          )}

          <Section title={t('extraScreens.agents.cloud')} count={center.cloudActive.length || undefined}>
            {!cloud.enabled && cloud.runs.length === 0 && <div className="px-3 py-2 text-muted-foreground">{t('extraScreens.agents.cloudOff')}</div>}
            {cloud.enabled && center.cloudActive.length === 0 && center.cloudFailed.length === 0 && <div className="px-3 py-2 text-muted-foreground">{t('extraScreens.agents.cloudIdle')}</div>}
            {[...center.cloudActive, ...center.cloudFailed].map((run) => (
              <Row
                key={run.id}
                title={run.name}
                meta={[t(`extraScreens.agents.cloudState.${run.state}`), run.progress ? `${run.progress.completed}/${run.progress.total}` : null, run.tokens ? t('extraScreens.agents.tokens', { n: run.tokens.toLocaleString(i18n.language) }) : null, run.failureReason, ago(run.createdAt)].filter(Boolean).join(' · ')}
              >
                {run.sessionId && <ScreenButton onClick={() => openSession(run.sessionId!)}>{t('extraScreens.radar.open')}</ScreenButton>}
                {(run.state === 'queued' || run.state === 'running') && (
                  <ScreenButton variant="danger" disabled={busy.has(`c:${run.id}`)} onClick={() => { void cancelCloud(run.id) }}>{t('extraScreens.agents.cancel')}</ScreenButton>
                )}
              </Row>
            ))}
          </Section>

          <Section
            title={t('extraScreens.agents.automations')}
            count={automations.length || undefined}
            actions={
              <>
                {pausedHere.length > 0 && <ScreenButton disabled={busy.has('resume')} onClick={() => { void resumePaused() }}>{t('extraScreens.agents.resumePaused', { n: pausedHere.length })}</ScreenButton>}
                {center.automationsEnabled.length > 0 && <ScreenButton disabled={busy.has('pause-all')} onClick={() => { void pauseAll() }}>{t('extraScreens.agents.pauseAll')}</ScreenButton>}
              </>
            }
          >
            {!automationsAvailable && <div className="px-3 py-2 text-muted-foreground">{t('extraScreens.agents.automationsUnavailable')}</div>}
            {automationsAvailable && automations.length === 0 && <div className="px-3 py-2 text-muted-foreground">{t('extraScreens.agents.noAutomations')}</div>}
            {automations.map((a) => (
              <Row key={a.id} title={a.name} meta={[a.cron ?? a.event, a.lastExecutedAt ? t('extraScreens.agents.lastRun', { ago: ago(a.lastExecutedAt) }) : t('extraScreens.agents.neverRun')].join(' · ')} dim={!a.enabled}>
                {!a.enabled && <Chip>{t('extraScreens.agents.paused')}</Chip>}
                <ScreenButton disabled={busy.has(`a:${a.id}`)} onClick={() => { void setAutomation(a, !a.enabled) }}>
                  {a.enabled ? t('extraScreens.agents.pause') : t('extraScreens.agents.resume')}
                </ScreenButton>
              </Row>
            ))}
          </Section>

        </div>
      </ScreenDetail>
    </ScreenRoot>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'err' }) {
  return (
    <div className="rounded-[8px] bg-foreground/[0.04] px-3.5 py-3">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className={cn('mt-0.5 text-[22px] font-bold tabular-nums leading-tight', tone === 'warn' && 'text-warning', tone === 'err' && 'text-destructive')}>{value}</div>
      {sub && <div className="text-[12px] text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Section({ title, count, hint, actions, children }: { title: string; count?: number; hint?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="flex items-center gap-2 pb-1">
        <h2 className="text-[11px] uppercase tracking-[0.05em] text-muted-foreground">{title}{count ? ` · ${count}` : ''}</h2>
        <span className="flex-1" />
        {actions}
      </div>
      {hint && <div className="pb-1 text-[12px] text-muted-foreground">{hint}</div>}
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  )
}

function Row({ title, meta, dim, children }: { title: string; meta?: string; dim?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-[6px] bg-foreground/[0.025] px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className={cn('truncate', dim && 'text-muted-foreground')}>{title}</div>
        {meta && <div className="truncate text-[12px] text-muted-foreground">{meta}</div>}
      </div>
      {children}
    </div>
  )
}
