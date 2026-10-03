import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Link2, CheckSquare, GitBranch, Globe, ShieldCheck, Trophy, Zap, Check, Clock3, Loader2, RefreshCw } from 'lucide-react'
import { QUEST_CLOUD_REQUIRED, QUEST_IDS, QUEST_XP_EVENT, XP_EVENT_REWARDS, getWeeklyXp } from '@craft-agent/shared/gamification/client'
import type { QuestId, QuestRecord } from '@craft-agent/shared/gamification'
import { cn } from '@/lib/utils'

const QUEST_ICONS = { first_note: BookOpen, first_link: Link2, first_task: CheckSquare, first_workflow: GitBranch, first_browser: Globe, privacy_review: ShieldCheck }
const QUEST_COLORS: Record<QuestId, string> = {
  first_note: 'border-violet-500/25 bg-violet-500/5 text-violet-700 dark:text-violet-300',
  first_link: 'border-blue-500/25 bg-blue-500/5 text-blue-700 dark:text-blue-300',
  first_task: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
  first_workflow: 'border-orange-500/25 bg-orange-500/5 text-orange-700 dark:text-orange-300',
  first_browser: 'border-cyan-500/25 bg-cyan-500/5 text-cyan-700 dark:text-cyan-300',
  privacy_review: 'border-rose-500/25 bg-rose-500/5 text-rose-700 dark:text-rose-300',
}
const QUEST_TITLE: Record<QuestId, string> = {
  first_note: 'quests.firstNote', first_link: 'quests.firstLink', first_task: 'quests.firstTask',
  first_workflow: 'quests.firstWorkflow', first_browser: 'quests.firstBrowser', privacy_review: 'quests.privacyReview',
}
const QUEST_SERVICE: Record<QuestId, string> = {
  first_note: 'quests.service.notes', first_link: 'quests.service.notes', first_task: 'quests.service.tasks',
  first_workflow: 'quests.service.workflows', first_browser: 'quests.service.browser', privacy_review: 'quests.service.privacy',
}
const TABS = ['active', 'completed', 'snoozed'] as const
const TAB_KEYS = { active: 'quests.active', completed: 'quests.completed', snoozed: 'quests.snoozedTab' }
type QuestAction = 'complete' | 'dismiss' | 'snooze'
type Profile = Awaited<ReturnType<typeof window.electronAPI.getGamificationProfile>>
type Failure = { kind: 'load' } | { kind: 'action'; action: QuestAction; questId: QuestId }
const BUTTON = 'rounded-lg px-3 py-2 text-xs font-medium transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none'

interface QuestProgressCardProps {
  cloudFeaturesEnabled?: boolean
  className?: string
  /** Changing the bound workspace invalidates in-flight replies, including A → B → A. */
  scopeKey?: string
}

export function QuestProgressCard({ cloudFeaturesEnabled = true, className, scopeKey }: QuestProgressCardProps) {
  const { t, i18n } = useTranslation()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [page, setPage] = useState(0)
  const [tab, setTab] = useState<(typeof TABS)[number]>('active')
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState<QuestId | 'reload' | null>(null)
  const sequence = useRef(0)
  const lifetime = useRef(0)
  const mounted = useRef(false)
  const actionPending = useRef(false)
  const boundScope = useRef(scopeKey)
  if (boundScope.current !== scopeKey) {
    boundScope.current = scopeKey
    lifetime.current++
    sequence.current++
    actionPending.current = false
  }

  const reload = useCallback(async () => {
    const request = ++sequence.current
    const generation = lifetime.current
    const current = () => mounted.current && generation === lifetime.current && request === sequence.current
    try {
      if (!window.electronAPI.getGamificationProfile) throw new Error('XP profile unavailable')
      const next = await window.electronAPI.getGamificationProfile()
      if (!current()) return
      setProfile(next)
      setFailure(previous => previous?.kind === 'action' ? previous : null)
    } catch {
      if (current()) setFailure({ kind: 'load' })
    } finally { if (current()) setReady(true) }
  }, [scopeKey])

  useEffect(() => {
    mounted.current = true
    setReady(false)
    setProfile(null)
    setFailure(null)
    setBusy(null)
    setPage(0)
    setTab('active')
    void reload()
    const off = window.electronAPI.onGamificationChanged?.(() => { void reload() })
    return () => {
      mounted.current = false
      lifetime.current++
      sequence.current++
      actionPending.current = false
      off?.()
    }
  }, [reload])

  const act = useCallback(async (action: QuestAction, questId: QuestId) => {
    if (actionPending.current) return
    actionPending.current = true
    const generation = lifetime.current
    setBusy(questId)
    setFailure(null)
    try {
      await window.electronAPI.applyGamificationQuest({ action, questId, cloudFeaturesEnabled })
      if (!mounted.current || generation !== lifetime.current) return
      await reload()
    } catch {
      if (mounted.current && generation === lifetime.current) setFailure({ kind: 'action', action, questId })
    } finally {
      if (mounted.current && generation === lifetime.current) { actionPending.current = false; setBusy(null) }
    }
  }, [cloudFeaturesEnabled, reload])

  const retry = async () => {
    if (failure?.kind === 'action') { await act(failure.action, failure.questId); return }
    if (actionPending.current) return
    actionPending.current = true
    const generation = lifetime.current
    setBusy('reload')
    try { await reload() } finally {
      if (mounted.current && generation === lifetime.current) { actionPending.current = false; setBusy(null) }
    }
  }

  if (!ready) return <div className={cn('flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground', className)} role="status"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" />{t('quests.loading')}</div>

  const now = Date.now()
  const records = profile?.questRecords ?? profile?.quests ?? []
  const active = records.filter(quest => (quest.status === 'available' || (quest.status === 'snoozed' && (quest.snoozeUntil ?? 0) <= now)) && (cloudFeaturesEnabled || !QUEST_CLOUD_REQUIRED[quest.id]))
  const completed = records.filter(quest => quest.status === 'completed')
  const snoozed = records.filter(quest => quest.status === 'snoozed' && (quest.snoozeUntil ?? 0) > now)
  const groups = { active, completed, snoozed }
  const quests = groups[tab]
  const pages = Math.max(1, Math.ceil(quests.length / 3))
  const safePage = Math.min(page, pages - 1)
  const weekly = profile?.weeklyXp ?? getWeeklyXp({ recentEvents: profile?.recentEvents })
  const goal = Math.max(50, weekly.previous + 25)
  const weeklyProgress = Math.min(100, Math.round(weekly.current / goal * 100))

  return <section className={cn('min-w-0 space-y-4', className)} aria-label={t('quests.sectionTitle')} data-testid="quest-progress-card" aria-busy={busy !== null}>
    {failure && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm">
      <p>{t(failure.kind === 'load' ? 'quests.loadError' : 'quests.actionError')}</p>
      <button type="button" disabled={busy !== null} onClick={() => void retry()} className={BUTTON}><RefreshCw className="mr-1 inline size-3.5" />{t('common.retry')}</button>
    </div>}
    {profile && <>
      <div className="grid min-w-0 gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 to-blue-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-semibold"><Zap className="size-5 text-violet-500" />{t('quests.levelLabel', { level: profile.level })}</h3><span className="text-sm font-semibold tabular-nums">{t('quests.xpAmount', { xp: profile.xp })}</span></div>
          <p className="mt-2 text-xs text-muted-foreground">{profile.nextThreshold === null ? t('quests.maxLevel') : t('quests.levelProgress', { xp: profile.xpForNext })}</p>
          <div role="progressbar" aria-label={t('quests.levelLabel', { level: profile.level })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(profile.progress * 100)} className="mt-3 h-2 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-violet-500 transition-[width] motion-reduce:transition-none" style={{ width: `${Math.max(0, Math.min(100, profile.progress * 100))}%` }} /></div>
          <p className="mt-3 text-xs text-muted-foreground">{t('quests.completedCount', { completed: completed.length, total: QUEST_IDS.length })}</p>
        </div>
        <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-orange-500/5 p-4">
          <h3 className="flex items-center gap-2 font-semibold"><Trophy className="size-5 text-amber-500" />{t('quests.weeklyChallenge')}</h3>
          <p className="mt-2 text-xs text-muted-foreground">{t('quests.weeklyWindow')}</p>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs tabular-nums"><span>{t('quests.xpAmount', { xp: weekly.current })} / {t('quests.xpAmount', { xp: goal })}</span><span>{t('quests.previousWeek', { xp: weekly.previous })}</span></div>
          <div role="progressbar" aria-label={t('quests.weeklyChallenge')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={weeklyProgress} className="mt-2 h-2 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-amber-500 transition-[width] motion-reduce:transition-none" style={{ width: `${weeklyProgress}%` }} /></div>
          <p className="mt-3 text-xs text-muted-foreground">{t(weekly.current >= goal ? 'quests.weeklyGoalReached' : 'quests.personalChallenge')}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1 rounded-xl border border-border/70 bg-foreground/[0.025] p-1" aria-label={t('quests.sectionTitle')}>
        {TABS.map(value => <button type="button" key={value} aria-pressed={tab === value} onClick={() => { setTab(value); setPage(0) }} className={cn(BUTTON, 'flex items-center gap-1.5', tab === value && 'bg-background shadow-sm text-foreground')}>
          {value === 'completed' ? <Trophy className="size-3.5" /> : value === 'snoozed' ? <Clock3 className="size-3.5" /> : <Zap className="size-3.5" />}{t(TAB_KEYS[value])}<span className="rounded-full bg-foreground/5 px-1.5 tabular-nums">{groups[value].length}</span>
        </button>)}
      </div>
      {quests.length === 0 ? <div className="rounded-xl border border-dashed border-border/70 bg-foreground/[0.025] px-4 py-6 text-center" data-testid="quest-progress-card-empty"><Trophy className="mx-auto mb-2 size-6 text-amber-500" /><p className="text-sm font-medium">{t(tab === 'completed' ? 'quests.emptyCompleted' : tab === 'snoozed' ? 'quests.emptySnoozed' : 'quests.emptyActive')}</p><p className="mt-1 text-xs text-muted-foreground">{t('quests.emptyHint')}</p><span className="sr-only">{t('quests.empty')}</span></div> : <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {quests.slice(safePage * 3, safePage * 3 + 3).map(quest => {
          const Icon = QUEST_ICONS[quest.id]
          const title = t(QUEST_TITLE[quest.id])
          return <article key={quest.id} data-quest-id={quest.id} className={cn('flex min-w-0 flex-col gap-3 rounded-xl border p-4 shadow-sm', QUEST_COLORS[quest.id])}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="grid size-10 place-items-center rounded-xl bg-background/70"><Icon className="size-5" aria-hidden="true" /></span><span className="flex items-center gap-1 rounded-full bg-background/70 px-2 py-1 text-xs font-semibold">{quest.status === 'completed' ? <Check className="size-3" /> : <Zap className="size-3" />}{quest.status === 'completed' && `${t('quests.earned')} `}{t('quests.xpAmount', { xp: XP_EVENT_REWARDS[QUEST_XP_EVENT[quest.id]] })}</span></div>
            <div className="flex-1"><p className="text-[10px] uppercase tracking-wide opacity-75">{t(QUEST_SERVICE[quest.id])}</p><h4 className="mt-1 break-words text-sm font-semibold">{title}</h4></div>
            {quest.status === 'completed' ? <p className="text-xs text-muted-foreground">{quest.completedAt ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(quest.completedAt) : t('quests.completed')}</p> : quest.status === 'snoozed' && (quest.snoozeUntil ?? 0) > now ? <p className="text-xs text-muted-foreground">{t('quests.snoozedUntil', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(quest.snoozeUntil) })}</p> : <>
              <button type="button" disabled={busy !== null} aria-label={t('quests.actionLabel', { action: t('quests.done'), quest: title })} className={cn(BUTTON, 'bg-background/80 font-semibold shadow-sm')} onClick={() => void act('complete', quest.id)}>{busy === quest.id ? <Loader2 className="mx-auto size-4 animate-spin motion-reduce:animate-none" /> : t('quests.done')}</button>
              <div className="flex flex-wrap justify-between gap-1 text-xs"><button type="button" className={BUTTON} disabled={busy !== null} aria-label={t('quests.actionLabel', { action: t('quests.snooze'), quest: title })} onClick={() => void act('snooze', quest.id)}>{t('quests.snooze')}</button><button type="button" className={BUTTON} disabled={busy !== null} aria-label={t('quests.actionLabel', { action: t('quests.dismiss'), quest: title })} onClick={() => void act('dismiss', quest.id)}>{t('quests.dismiss')}</button></div>
            </>}
          </article>
        })}
      </div>}
      {pages > 1 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><button type="button" className={BUTTON} disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>{t('quests.previous')}</button><span>{t('quests.pageStatus', { page: safePage + 1, total: pages })}</span><button type="button" className={BUTTON} disabled={safePage === pages - 1} onClick={() => setPage(safePage + 1)}>{t('quests.next')}</button></div>}
    </>}
  </section>
}
