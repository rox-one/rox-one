/**
 * AutomationEditor
 *
 * Single-automation editor for the right panel. Three steps as sections —
 * Когда (trigger + schedule builder), Если (optional conditions),
 * Сделать (prompt, model, target session) — followed by run history.
 *
 * Saving is explicit (button / ⌘S) with a dirty indicator; the on/off switch,
 * «Запустить сейчас», duplicate and delete act immediately through the
 * automations RPC (setEnabled / update / test / duplicate / delete).
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Copy, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import type { LlmConnection, PermissionMode } from '../../../shared/types'
import { AutomationSwitch } from './AutomationsListPanel'
import {
  EVENT_MATCH_FIELD,
  EVENT_PICKER_GROUPS,
  describeSchedule,
  describeTrigger,
  getAutomationGroup,
  getEventDisplayName,
  weekdayShortName,
  type AutomationAction,
  type AutomationConditionUI,
  type AutomationGroup,
  type AutomationListItem,
  type AutomationTrigger,
  type ExecutionEntry,
  type PromptAction,
  type StateConditionUI,
  type TimeConditionUI,
  type WebhookAction,
} from './types'
import { DEFAULT_SCHEDULE, buildCron, isPlausibleCron, parseSchedule, type ScheduleKind, type ScheduleModel } from './schedule-model'
import { computeNextRuns } from './utils'
import { ContextBindingEditor, saveAutomationContextBinding } from './ContextBindingEditor'
import { useAutomationContextCatalog } from './useAutomationContextCatalog'
import './automations.css'
import { TourScopeContext, useTourSignals, useTourTarget } from '@/features/product-tour/runtime/hooks'
import { meetingsAutomationCapabilities } from '@/features/product-tour/adapters/work/meetings-automations'

// ============================================================================
// Draft model
// ============================================================================

interface Draft {
  name: string
  event: AutomationTrigger
  matcher: string
  schedule: ScheduleModel
  timezone: string
  conditions: AutomationConditionUI[]
  prompt: string
  llmConnection: string
  model: string
  permissionMode: PermissionMode
  labels: string
  telegramTopic: string
  webhookUrl: string
  webhookMethod: NonNullable<WebhookAction['method']>
  webhookBodyFormat: NonNullable<WebhookAction['bodyFormat']>
  webhookHeaders: string
  webhookBody: string
  webhookCaptureResponse: boolean
  webhookAuthMode: 'none' | 'keep' | 'basic' | 'bearer'
  webhookUsername: string
  webhookPassword: string
  webhookToken: string
}

function draftFrom(a: AutomationListItem): Draft {
  const first = a.actions[0]
  const prompt = first?.type === 'prompt' ? first : undefined
  const webhook = first?.type === 'webhook' ? first : undefined
  return {
    name: a.name,
    event: a.event,
    matcher: a.matcher ?? '',
    schedule: parseSchedule(a.cron),
    timezone: a.timezone ?? '',
    conditions: a.conditions ?? [],
    prompt: prompt?.prompt ?? '',
    llmConnection: prompt?.llmConnection ?? '',
    model: prompt?.model ?? '',
    permissionMode: a.permissionMode ?? 'safe',
    labels: (a.labels ?? []).join(', '),
    telegramTopic: a.telegramTopic ?? '',
    webhookUrl: webhook?.url ?? '',
    webhookMethod: webhook?.method ?? 'POST',
    webhookBodyFormat: webhook?.bodyFormat ?? 'json',
    webhookHeaders: JSON.stringify(webhook?.headers ?? {}, null, 2),
    webhookBody: webhook?.body === undefined ? '' : typeof webhook.body === 'string' ? webhook.body : JSON.stringify(webhook.body, null, 2),
    webhookCaptureResponse: webhook?.captureResponse ?? false,
    webhookAuthMode: webhook?.authConfigured || webhook?.auth ? 'keep' : 'none',
    webhookUsername: '',
    webhookPassword: '',
    webhookToken: '',
  }
}

/** Compare editable inputs without parsing partially typed webhook JSON. */
function comparable(draft: Draft): string {
  return JSON.stringify(draft)
}

function buildActions(original: AutomationAction[], d: Draft): AutomationAction[] {
  const first = original[0]
  if (first?.type === 'webhook') {
    const next: WebhookAction = {
      ...first,
      url: d.webhookUrl.trim(),
      method: d.webhookMethod,
      bodyFormat: d.webhookBodyFormat,
      headers: d.webhookHeaders.trim() ? JSON.parse(d.webhookHeaders) as Record<string, string> : undefined,
      body: d.webhookBody.trim()
        ? d.webhookBodyFormat === 'raw' ? d.webhookBody : JSON.parse(d.webhookBody)
        : undefined,
      captureResponse: d.webhookCaptureResponse,
    }
    delete next.authConfigured
    delete next.authType
    if (d.webhookAuthMode === 'none') delete next.auth
    if (d.webhookAuthMode === 'basic') next.auth = { type: 'basic', username: d.webhookUsername.trim(), password: d.webhookPassword }
    if (d.webhookAuthMode === 'bearer') next.auth = { type: 'bearer', token: d.webhookToken }
    if (d.webhookAuthMode === 'keep') next.authConfigured = true
    return [next, ...original.slice(1)]
  }

  if (first && first.type !== 'prompt') return original
  const base: PromptAction = first?.type === 'prompt' ? { ...first } : { type: 'prompt', prompt: '' }
  const next: PromptAction = { ...base, prompt: d.prompt }
  if (d.llmConnection) next.llmConnection = d.llmConnection
  else delete next.llmConnection
  if (d.model) next.model = d.model
  else delete next.model
  return [next, ...original.slice(1)]
}

/** Matcher payload for automations:update — keys set to undefined are removed server-side. */
function buildMatcher(a: AutomationListItem, d: Draft): Record<string, unknown> {
  const scheduled = d.event === 'SchedulerTick'
  const labels = d.labels.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    name: d.name.trim() || undefined,
    matcher: !scheduled && EVENT_MATCH_FIELD[d.event] && d.matcher.trim() ? d.matcher.trim() : undefined,
    cron: scheduled ? buildCron(d.schedule) : undefined,
    timezone: scheduled && d.timezone ? d.timezone : undefined,
    conditions: d.conditions.length ? d.conditions : undefined,
    permissionMode: d.permissionMode,
    labels: labels.length ? labels : undefined,
    telegramTopic: d.telegramTopic.trim() || undefined,
    webhookAuthMode: d.webhookAuthMode,
    actions: buildActions(a.actions, d),
  }
}

function validWebhookHeaders(text: string): boolean {
  if (!text.trim()) return true
  try {
    const headers: unknown = JSON.parse(text)
    return !!headers && typeof headers === 'object' && !Array.isArray(headers) &&
      Object.values(headers).every((value) => typeof value === 'string')
  } catch {
    return false
  }
}

function validate(d: Draft, a: AutomationListItem, t: (k: string) => string): string | null {
  const webhook = a.actions[0]?.type === 'webhook'
  if (!webhook && !d.prompt.trim()) return t('automations.errPromptEmpty')
  if (webhook) {
    try {
      const url = new URL(d.webhookUrl)
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return t('automations.errWebhookUrl')
    } catch {
      return t('automations.errWebhookUrl')
    }
    if (!validWebhookHeaders(d.webhookHeaders)) return t('automations.errWebhookHeaders')
    if (d.webhookBody.trim() && d.webhookBodyFormat !== 'raw') {
      try { JSON.parse(d.webhookBody) } catch { return t('automations.errWebhookBody') }
    }
    if (d.webhookAuthMode === 'basic' && (!d.webhookUsername.trim() || !d.webhookPassword)) return t('automations.errWebhookAuth')
    if (d.webhookAuthMode === 'bearer' && !d.webhookToken) return t('automations.errWebhookAuth')
  }
  if (d.event === 'SchedulerTick') {
    const cron = buildCron(d.schedule)
    if (!isPlausibleCron(cron) || computeNextRuns(cron, 1, d.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone).length === 0) return t('automations.errCronInvalid')
  } else if (d.matcher.trim()) {
    try { new RegExp(d.matcher.trim()) } catch { return t('automations.errMatcherInvalid') }
  }
  return null
}

// ============================================================================
// Small pieces
// ============================================================================

const GROUP_KEYS: Record<AutomationGroup, string> = {
  scheduled: 'automations.groupScheduled',
  event: 'automations.groupEvent',
  agent: 'automations.groupAgent',
}

/** Monday-first cron day numbers. */
const WEEK: number[] = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAY_TOKENS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

function Step({ n, title, hint, children, testId, tourRef }: { n: number; title: string; hint?: string; children: React.ReactNode; testId?: string; tourRef?: React.Ref<HTMLElement> }) {
  return (
    <section ref={tourRef} className="rox-autom-step" data-testid={testId}>
      <span className="rox-autom-step-num">{n}</span>
      <div className="rox-autom-step-head">
        <span className="rox-autom-step-title">{title}</span>
        {hint && <span className="rox-autom-step-hint">{hint}</span>}
      </div>
      <div className="rox-autom-step-body">{children}</div>
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('rox-autom-field', className)}>
      <span className="rox-autom-label">{label}</span>
      {children}
    </label>
  )
}

function WeekdayChips({ value, onChange, locale }: { value: number[]; onChange: (days: number[]) => void; locale: string }) {
  return (
    <div className="rox-autom-inline" role="group">
      {WEEK.map((d) => {
        const on = value.includes(d)
        return (
          <button
            key={d}
            type="button"
            className="rox-autom-chip"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d])}
          >
            {weekdayShortName(d, locale)}
          </button>
        )
      })}
    </div>
  )
}

function ScheduleBuilder({
  value,
  onChange,
  timezone,
  onTimezoneChange,
}: {
  value: ScheduleModel
  onChange: (next: ScheduleModel) => void
  timezone: string
  onTimezoneChange: (tz: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'ru'
  const cron = buildCron(value)
  const valid = isPlausibleCron(cron)
  const systemTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const nextRuns = React.useMemo(() => (valid ? computeNextRuns(cron, 3, timezone || systemTz) : []), [cron, valid, timezone, systemTz])
  const zones = React.useMemo(() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf
    const list = typeof supported === 'function' ? supported('timeZone') : []
    return list.length ? list : ['Europe/Moscow', 'UTC', systemTz]
  }, [systemTz])
  const kinds: ScheduleKind[] = ['daily', 'weekdays', 'weekly', 'monthly', 'hourly', 'minutes', 'custom']
  const set = (patch: Partial<ScheduleModel>) => onChange({ ...value, ...patch })
  const needsTime = value.kind === 'daily' || value.kind === 'weekdays' || value.kind === 'weekly' || value.kind === 'monthly'

  return (
    <>
      <div className="rox-autom-grid">
        <Field label={t('automations.schedRepeat')}>
          <select
            className="rox-autom-select"
            value={value.kind}
            data-testid="schedule-kind"
            onChange={(e) => {
              const kind = e.target.value as ScheduleKind
              set(kind === 'custom' ? { kind, cron } : { kind })
            }}
          >
            {kinds.map((k) => <option key={k} value={k}>{t(`automations.schedKind.${k}`)}</option>)}
          </select>
        </Field>
        {needsTime && (
          <Field label={t('automations.schedTime')}>
            <input type="time" className="rox-autom-input" value={value.time} onChange={(e) => set({ time: e.target.value || DEFAULT_SCHEDULE.time })} />
          </Field>
        )}
        {value.kind === 'monthly' && (
          <Field label={t('automations.schedDayOfMonth')}>
            <input type="number" min={1} max={31} className="rox-autom-input" value={value.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} />
          </Field>
        )}
        {value.kind === 'hourly' && (
          <Field label={t('automations.schedMinute')}>
            <input type="number" min={0} max={59} className="rox-autom-input" value={value.minute} onChange={(e) => set({ minute: Number(e.target.value) })} />
          </Field>
        )}
        {value.kind === 'minutes' && (
          <Field label={t('automations.schedEvery')}>
            <select className="rox-autom-select" value={value.every} onChange={(e) => set({ every: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{t('automations.sched.everyNMinutes', { n })}</option>)}
            </select>
          </Field>
        )}
        {value.kind === 'custom' && (
          <Field label={t('automations.schedCron')}>
            <input
              className={cn('rox-autom-input rox-autom-mono', !valid && 'is-invalid')}
              value={value.cron}
              placeholder="0 9 * * 1-5"
              onChange={(e) => set({ cron: e.target.value })}
            />
          </Field>
        )}
        <Field label={t('automations.labelTimezone')}>
          <select className="rox-autom-select" value={timezone} onChange={(e) => onTimezoneChange(e.target.value)}>
            <option value="">{t('automations.tzSystem', { tz: systemTz })}</option>
            {timezone && !zones.includes(timezone) && <option value={timezone}>{timezone}</option>}
            {zones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </Field>
      </div>
      {value.kind === 'weekly' && (
        <WeekdayChips value={value.days} onChange={(days) => set({ days })} locale={locale} />
      )}
      <p className="rox-autom-note">
        {valid ? describeSchedule(cron, t, locale) : t('automations.errCronInvalid')}
        {nextRuns.length > 0 && (
          <>
            {' · '}
            {t('automations.nextRuns')}{' '}
            {nextRuns.map((d) => d.toLocaleString(locale, { timeZone: timezone || systemTz, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })).join(', ')}
          </>
        )}
      </p>
    </>
  )
}

// ---------- conditions ----------

type StateOp = 'value' | 'not_value' | 'contains' | 'to'
const STATE_FIELDS = ['sessionStatus', 'permissionMode', 'isFlagged', 'labels', 'sessionName'] as const

function stateOp(c: StateConditionUI): StateOp {
  if (c.contains !== undefined) return 'contains'
  if (c.not_value !== undefined) return 'not_value'
  if (c.to !== undefined) return 'to'
  return 'value'
}

function stateValue(c: StateConditionUI): string {
  const v = c.contains ?? c.not_value ?? c.to ?? c.value
  return v === undefined ? '' : String(v)
}

function makeState(field: string, op: StateOp, raw: string): StateConditionUI {
  const value: unknown = field === 'isFlagged' ? raw === 'true' : raw
  const c: StateConditionUI = { condition: 'state', field }
  if (op === 'contains') c.contains = raw
  else if (op === 'not_value') c.not_value = value
  else if (op === 'to') c.to = value
  else c.value = value
  return c
}

function describeLogical(c: AutomationConditionUI, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (c.condition === 'time') {
    const parts: string[] = []
    if (c.weekday?.length) parts.push(c.weekday.join(', '))
    if (c.after) parts.push(t('automations.condAfter') + ' ' + c.after)
    if (c.before) parts.push(t('automations.condBefore') + ' ' + c.before)
    return parts.join(' ') || t('automations.condAnyTime')
  }
  if (c.condition === 'state') return `${t(`automations.condField.${c.field}`, { defaultValue: c.field })} ${stateValue(c)}`
  const sep = ` ${t(`automations.condOp.${c.condition}`)} `
  return c.conditions.map((x) => describeLogical(x, t)).join(sep)
}

function ConditionRow({
  value,
  onChange,
  onRemove,
  locale,
}: {
  value: AutomationConditionUI
  onChange: (next: AutomationConditionUI) => void
  onRemove: () => void
  locale: string
}) {
  const { t } = useTranslation()
  const remove = (
    <button type="button" className="rox-autom-btn is-ghost is-icon ml-auto" onClick={onRemove} aria-label={t('automations.condRemove')} title={t('automations.condRemove')}>
      <X className="size-3.5" />
    </button>
  )
  if (value.condition === 'time') {
    const c: TimeConditionUI = value
    const days = (c.weekday ?? []).map((w) => WEEKDAY_TOKENS.indexOf(w.toLowerCase().slice(0, 3) as typeof WEEKDAY_TOKENS[number])).filter((n) => n >= 0)
    return (
      <div className="rox-autom-cond">
        <span className="rox-autom-label">{t('automations.condTime')}</span>
        <WeekdayChips
          value={days}
          locale={locale}
          onChange={(next) => onChange({ ...c, weekday: next.length ? WEEK.filter((d) => next.includes(d)).map((d) => WEEKDAY_TOKENS[d]!) : undefined })}
        />
        <span className="rox-autom-label">{t('automations.condAfter')}</span>
        <input type="time" className="rox-autom-input" style={{ width: 110 }} value={c.after ?? ''} onChange={(e) => onChange({ ...c, after: e.target.value || undefined })} />
        <span className="rox-autom-label">{t('automations.condBefore')}</span>
        <input type="time" className="rox-autom-input" style={{ width: 110 }} value={c.before ?? ''} onChange={(e) => onChange({ ...c, before: e.target.value || undefined })} />
        {remove}
      </div>
    )
  }
  if (value.condition === 'state') {
    const c: StateConditionUI = value
    const op = stateOp(c)
    const raw = stateValue(c)
    return (
      <div className="rox-autom-cond">
        <select className="rox-autom-select" style={{ width: 170 }} value={c.field} onChange={(e) => onChange(makeState(e.target.value, op, raw))}>
          {!(STATE_FIELDS as readonly string[]).includes(c.field) && <option value={c.field}>{c.field}</option>}
          {STATE_FIELDS.map((f) => <option key={f} value={f}>{t(`automations.condField.${f}`)}</option>)}
        </select>
        <select className="rox-autom-select" style={{ width: 150 }} value={op} onChange={(e) => onChange(makeState(c.field, e.target.value as StateOp, raw))}>
          {(['value', 'not_value', 'contains', 'to'] as StateOp[]).map((o) => <option key={o} value={o}>{t(`automations.condStateOp.${o}`)}</option>)}
        </select>
        {c.field === 'isFlagged' ? (
          <select className="rox-autom-select" style={{ width: 150 }} value={raw || 'true'} onChange={(e) => onChange(makeState(c.field, op, e.target.value))}>
            <option value="true">{t('automations.flagOn')}</option>
            <option value="false">{t('automations.flagOff')}</option>
          </select>
        ) : (
          <input className="rox-autom-input" style={{ flex: 1, minWidth: 120 }} value={raw} placeholder={t('automations.condValuePlaceholder')} onChange={(e) => onChange(makeState(c.field, op, e.target.value))} />
        )}
        {remove}
      </div>
    )
  }
  return (
    <div className="rox-autom-cond">
      <span className="rox-autom-label">{t('automations.condComplex')}</span>
      <span className="text-[13px]">{describeLogical(value, t)}</span>
      {remove}
    </div>
  )
}

// ---------- history ----------

function RunHistory({ entries, loading, onRefresh }: { entries: ExecutionEntry[]; loading: boolean; onRefresh: () => void }) {
  const { t, i18n } = useTranslation()
  const { navigateToSession } = useNavigation()

  const locale = i18n.language || 'ru'
  return (
    <div data-testid="automation-history">
      <div className="rox-autom-inline" style={{ margin: '22px 0 6px 10px' }}>
        <span className="rox-autom-step-title">{t('automations.historyTitle')}</span>
        <span className="rox-autom-step-hint">{entries.length ? t('automations.lastNRuns', { count: entries.length }) : ''}</span>
        <button type="button" className="rox-autom-btn is-ghost is-icon ml-auto" onClick={onRefresh} aria-label={t('automations.historyRefresh')} title={t('automations.historyRefresh')}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="rox-autom-note" style={{ paddingLeft: 10 }}>{t('automations.historyEmpty')}</p>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="rox-autom-history-row">
            <span className={cn('rox-autom-dot', e.status === 'success' ? 'is-ok' : 'is-error')} aria-label={e.status === 'success' ? t('automations.runOk') : t('automations.runFailed')} />
            <span className="rox-autom-when">
              {new Date(e.timestamp).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
            </span>
            <span className={cn('rox-autom-what', e.status !== 'success' && 'text-destructive')} title={e.error ?? e.actionSummary}>
              {e.status === 'success' ? (e.actionSummary ?? t('automations.runOk')) : (e.error ?? t('automations.runFailed'))}
            </span>
            {e.sessionId && (
              <button type="button" className="rox-autom-link shrink-0" onClick={() => navigateToSession(e.sessionId!)}>
                {t('automations.openSession')}
              </button>
            )}
          </div>
        ))
      )}
    </div>
  )
}

// ============================================================================
// Editor
// ============================================================================

export interface AutomationEditorProps {
  automation: AutomationListItem
  workspaceId: string | null | undefined
  className?: string
}

export function AutomationEditor({ automation, workspaceId, className }: AutomationEditorProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'ru'
  const { onToggleAutomation, onDeleteAutomation, getAutomationHistory } = useAppShellContext()
  const { navigateToSession } = useNavigation()

  const tourScope = React.useContext(TourScopeContext)
  const tourSignals = useTourSignals()
  const nativeTargetScope = { workspaceId: workspaceId ?? undefined, entityId: automation.id }
  const triggerTarget = useTourTarget('automation.trigger', nativeTargetScope)
  const actionTarget = useTourTarget('automation.action', nativeTargetScope)
  const controlsTarget = useTourTarget('automation.controls', nativeTargetScope)

  React.useEffect(() => {
    const capabilities = meetingsAutomationCapabilities({
      surface: 'automation', workspaceId,
      apiAvailable: Boolean(window.electronAPI),
      selectedId: tourScope?.entityId, automation,
    })
    const available = tourSignals.capability('automations.available', capabilities['automations.available']!)
    const entity = tourSignals.capability('automation.entity-present', capabilities['automation.entity-present']!)
    return () => { available(); entity() }
  }, [tourSignals, tourScope?.entityId, workspaceId, automation.id, automation.revision])

  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(automation))
  const [saving, setSaving] = React.useState(false)
  const [running, setRunning] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [connections, setConnections] = React.useState<LlmConnection[]>([])
  const [history, setHistory] = React.useState<ExecutionEntry[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const contextCatalog = useAutomationContextCatalog(workspaceId)

  const baseline = React.useMemo(() => comparable(draftFrom(automation)), [automation])
  const dirty = comparable(draft) !== baseline
  const dirtyRef = React.useRef(dirty)
  dirtyRef.current = dirty

  // Switching automations resets the draft; a background refresh of the same
  // automation only replaces it when there are no local edits.
  const lastIdRef = React.useRef(automation.id)
  React.useEffect(() => {
    if (lastIdRef.current !== automation.id) {
      lastIdRef.current = automation.id
      setDraft(draftFrom(automation))
      setSaveError(null)
      return
    }
    if (!dirtyRef.current) setDraft(draftFrom(automation))
  }, [automation])

  React.useEffect(() => {
    let cancelled = false
    window.electronAPI.listLlmConnections().then((list) => { if (!cancelled) setConnections(list ?? []) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const refreshHistory = React.useCallback(async () => {
    if (!getAutomationHistory) return
    setHistoryLoading(true)
    try {
      setHistory(await getAutomationHistory(automation.id))
    } finally {
      setHistoryLoading(false)
    }
  }, [getAutomationHistory, automation.id])

  React.useEffect(() => {
    void refreshHistory()
    return window.electronAPI.onAutomationsChanged(() => { void refreshHistory() })
  }, [refreshHistory])

  const error = validate(draft, automation, t)
  const set = React.useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), [])

  const save = React.useCallback(async (): Promise<boolean> => {
    if (!workspaceId) return false
    if (error) { setSaveError(error); return false }
    setSaving(true)
    setSaveError(null)
    try {
      await window.electronAPI.updateAutomation(workspaceId, automation.event, automation.matcherIndex, {
        event: draft.event,
        expectedRevision: automation.revision,
        matcher: buildMatcher(automation, draft),
      })
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSaveError(message)
      toast.error(t('automations.saveFailed'), { description: message })
      return false
    } finally {
      setSaving(false)
    }
  }, [workspaceId, error, automation, draft, t])

  // ⌘S / Ctrl+S saves while the editor is mounted.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirtyRef.current) void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  const runNow = React.useCallback(async () => {
    if (!workspaceId || running) return
    if (dirty && !(await save())) return
    const labels = draft.labels.split(',').map((s) => s.trim()).filter(Boolean)
    setRunning(true)
    try {
      const result = await window.electronAPI.testAutomation({
        workspaceId,
        automationId: automation.id,
        automationName: draft.name || automation.name,
        actions: buildActions(automation.actions, draft),
        permissionMode: draft.permissionMode,
        labels: labels.length ? labels : undefined,
        telegramTopic: draft.telegramTopic.trim() || undefined,
      })
      const actions = result.actions ?? []
      const failed = actions.find((a) => !a.success)
      const sessionId = actions.map((a) => ('sessionId' in a ? a.sessionId : undefined)).find(Boolean) as string | undefined
      if (actions.length === 0 || failed) {
        const detail = failed ? ('stderr' in failed && failed.stderr) || ('error' in failed && failed.error) || undefined : undefined
        toast.error(t('automations.runFailed'), { description: detail ? String(detail) : undefined })
      } else {
        toast.success(t('automations.runStarted'), sessionId
          ? { action: { label: t('automations.openSession'), onClick: () => navigateToSession(sessionId) } }
          : undefined)
      }
    } catch (err) {
      toast.error(t('automations.runFailed'), { description: err instanceof Error ? err.message : undefined })
    } finally {
      setRunning(false)
      void refreshHistory()
    }
  }, [workspaceId, running, dirty, save, draft, automation, t, navigateToSession, refreshHistory])

  const duplicate = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await window.electronAPI.duplicateAutomation(workspaceId, automation.event, automation.matcherIndex, t('automations.copyName', { name: automation.name }))
      if (res && typeof res === 'object' && res.id) navigate(routes.view.automations({ automationId: res.id }))
    } catch {
      toast.error(t('toast.failedToDuplicateAutomation'))
    }
  }, [workspaceId, automation.event, automation.matcherIndex, automation.name, t])

  const group = getAutomationGroup(draft.event)
  const matchField = EVENT_MATCH_FIELD[draft.event]
  const promptAction = automation.actions[0]?.type === 'prompt' || automation.actions.length === 0
  const selectedConnection = connections.find((c) => c.slug === draft.llmConnection)
  const modelOptions = React.useMemo(() => {
    const ids = (selectedConnection?.models ?? []).map((m) => (typeof m === 'string' ? { id: m, name: m } : { id: m.id, name: m.name || m.id }))
    if (draft.model && !ids.some((m) => m.id === draft.model)) ids.unshift({ id: draft.model, name: draft.model })
    return ids
  }, [selectedConnection, draft.model])

  const summary = describeTrigger(
    { event: draft.event, cron: draft.event === 'SchedulerTick' ? buildCron(draft.schedule) : undefined, matcher: draft.matcher.trim() || undefined },
    t,
    locale,
  )

  const status = saving
    ? { cls: '', text: t('automations.saving') }
    : saveError
      ? { cls: 'is-error', text: saveError }
      : dirty
        ? { cls: 'is-dirty', text: error ?? t('automations.unsaved') }
        : { cls: '', text: t('automations.saved') }

  return (
    <div className={cn('rox-autom-editor', className)} data-testid="automation-editor" data-automation-id={automation.id}>
      <div ref={controlsTarget} className="rox-autom-editor-bar">
        <input
          className="rox-autom-title-input"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          aria-label={t('automations.nameLabel')}
          placeholder={t('automations.nameLabel')}
        />
        <span className={cn('rox-autom-status', status.cls)} data-testid="automation-save-status" title={status.text}>
          {dirty && !saving && !saveError ? '● ' : ''}{status.text}
        </span>
        <AutomationSwitch
          checked={automation.enabled}
          onToggle={() => onToggleAutomation?.(automation.id)}
          label={automation.enabled ? t('automations.menuDisable') : t('automations.menuEnable')}
        />
        <button type="button" className="rox-autom-btn" onClick={runNow} disabled={running || saving} data-testid="automation-run-now">
          <Play className="size-3.5" />
          {running ? t('automations.running') : t('automations.runNow')}
        </button>
        <button type="button" className="rox-autom-btn is-ghost is-icon" onClick={duplicate} title={t('automations.menuDuplicate')} aria-label={t('automations.menuDuplicate')}>
          <Copy className="size-3.5" />
        </button>
        <button type="button" className="rox-autom-btn is-danger is-icon" onClick={() => onDeleteAutomation?.(automation.id)} title={t('automations.menuDelete')} aria-label={t('automations.menuDelete')}>
          <Trash2 className="size-3.5" />
        </button>
        <button type="button" className="rox-autom-btn is-primary" onClick={() => void save()} disabled={!dirty || saving || !!error} data-testid="automation-save">
          <Save className="size-3.5" />
          {t('automations.save')}
        </button>
      </div>
      <p className="rox-autom-summary">
        {automation.enabled ? summary : t('automations.pausedSummary', { summary })}
      </p>

      <div className="rox-autom-scroll">
        {workspaceId && <>
          {contextCatalog.catalog?.unavailable && <p role="status" className="text-xs text-muted-foreground">{t('automations.context.catalogUnavailable')}</p>}
          <ContextBindingEditor workspaceId={workspaceId} value={automation.context} paused={automation.contextPause}
            projects={contextCatalog.catalog?.projects ?? []} objects={contextCatalog.catalog?.objects ?? []}
            disabled={saving || running || dirty || !contextCatalog.catalog}
            onSave={async reference => { await saveAutomationContextBinding(workspaceId, automation, reference); contextCatalog.refresh() }} />
          <button type="button" className="rox-autom-btn is-ghost" onClick={contextCatalog.refresh}>{t('automations.context.refreshCatalog')}</button>
        </>}
        <Step tourRef={triggerTarget} n={1} title={t('automations.stepWhen')} hint={t('automations.stepWhenHint')} testId="automation-step-when">
          <div className="rox-autom-inline" role="group" aria-label={t('automations.stepWhen')}>
            {(['scheduled', 'event', 'agent'] as AutomationGroup[]).map((g) => (
              <button
                key={g}
                type="button"
                className="rox-autom-chip"
                aria-pressed={group === g}
                onClick={() => {
                  if (g === group) return
                  set({ event: EVENT_PICKER_GROUPS[g][0]!, matcher: '' })
                }}
              >
                {t(GROUP_KEYS[g])}
              </button>
            ))}
          </div>
          {group === 'scheduled' ? (
            <ScheduleBuilder
              value={draft.schedule}
              onChange={(schedule) => set({ schedule })}
              timezone={draft.timezone}
              onTimezoneChange={(timezone) => set({ timezone })}
            />
          ) : (
            <div className="rox-autom-grid">
              <Field label={t('automations.eventLabel')}>
                <select
                  className="rox-autom-select"
                  value={draft.event}
                  data-testid="automation-event"
                  onChange={(e) => set({ event: e.target.value as AutomationTrigger, matcher: '' })}
                >
                  {EVENT_PICKER_GROUPS[group].map((ev) => <option key={ev} value={ev}>{getEventDisplayName(ev, t)}</option>)}
                  {!EVENT_PICKER_GROUPS[group].includes(draft.event) && <option value={draft.event}>{getEventDisplayName(draft.event, t)}</option>}
                </select>
              </Field>
              {matchField === 'flag' ? (
                <Field label={t('automations.matchLabel.flag')}>
                  <select className="rox-autom-select" value={draft.matcher.replace(/^\^|\$$/g, '')} onChange={(e) => set({ matcher: e.target.value })}>
                    <option value="">{t('automations.flagAny')}</option>
                    <option value="true">{t('automations.flagOn')}</option>
                    <option value="false">{t('automations.flagOff')}</option>
                  </select>
                </Field>
              ) : matchField ? (
                <Field label={t(`automations.matchLabel.${matchField}`)}>
                  <input
                    className="rox-autom-input"
                    value={draft.matcher}
                    placeholder={t(`automations.matchPlaceholder.${matchField}`)}
                    onChange={(e) => set({ matcher: e.target.value })}
                  />
                </Field>
              ) : null}
            </div>
          )}
          {group === 'scheduled' && <p className="rox-autom-note">{t('automations.schedulingRequiresMachine')}</p>}
        </Step>

        <Step n={2} title={t('automations.stepIf')} hint={t('automations.stepIfHint')} testId="automation-step-if">
          {draft.conditions.length === 0 && <p className="rox-autom-note">{t('automations.condNone')}</p>}
          {draft.conditions.map((c, i) => (
            <ConditionRow
              key={i}
              value={c}
              locale={locale}
              onChange={(next) => set({ conditions: draft.conditions.map((x, j) => (j === i ? next : x)) })}
              onRemove={() => set({ conditions: draft.conditions.filter((_, j) => j !== i) })}
            />
          ))}
          <div className="rox-autom-inline">
            <button type="button" className="rox-autom-btn is-ghost" onClick={() => set({ conditions: [...draft.conditions, { condition: 'time', after: '09:00', before: '18:00' }] })}>
              <Plus className="size-3.5" />{t('automations.condAddTime')}
            </button>
            <button type="button" className="rox-autom-btn is-ghost" onClick={() => set({ conditions: [...draft.conditions, { condition: 'state', field: 'sessionStatus', value: '' }] })}>
              <Plus className="size-3.5" />{t('automations.condAddState')}
            </button>
          </div>
        </Step>

        <Step tourRef={actionTarget} n={3} title={t('automations.stepDo')} hint={t('automations.stepDoHint')} testId="automation-step-do">
          {promptAction ? (
            <>
              <Field label={t('automations.promptLabel')}>
                <textarea
                  className="rox-autom-textarea"
                  value={draft.prompt}
                  rows={5}
                  placeholder={t('automations.promptPlaceholder')}
                  onChange={(e) => set({ prompt: e.target.value })}
                  data-testid="automation-prompt"
                />
              </Field>
              <div className="rox-autom-grid">
                <Field label={t('automations.labelConnection')}>
                  <select className="rox-autom-select" value={draft.llmConnection} onChange={(e) => set({ llmConnection: e.target.value, model: '' })}>
                    <option value="">{t('automations.defaultOption')}</option>
                    {draft.llmConnection && !selectedConnection && <option value={draft.llmConnection}>{draft.llmConnection}</option>}
                    {connections.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label={t('automations.labelModel')}>
                  {modelOptions.length > 0 || !draft.llmConnection ? (
                    <select className="rox-autom-select" value={draft.model} onChange={(e) => set({ model: e.target.value })}>
                      <option value="">{t('automations.defaultOption')}</option>
                      {modelOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  ) : (
                    <input className="rox-autom-input" value={draft.model} placeholder={t('automations.defaultOption')} onChange={(e) => set({ model: e.target.value })} />
                  )}
                </Field>
              </div>
            </>
          ) : (
            <>
              <div className="rox-autom-grid">
                <Field label={t('automations.webhookUrl')}>
                  <input className="rox-autom-input" type="url" value={draft.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} data-testid="webhook-url" />
                </Field>
                <Field label={t('automations.webhookMethod')}>
                  <select className="rox-autom-select" value={draft.webhookMethod} onChange={(e) => set({ webhookMethod: e.target.value as NonNullable<WebhookAction['method']> })}>
                    {(['POST', 'GET', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => <option key={method} value={method}>{method}</option>)}
                  </select>
                </Field>
                <Field label={t('automations.webhookBodyFormat')}>
                  <select className="rox-autom-select" value={draft.webhookBodyFormat} onChange={(e) => set({ webhookBodyFormat: e.target.value as NonNullable<WebhookAction['bodyFormat']> })}>
                    {(['json', 'form', 'raw'] as const).map((format) => <option key={format} value={format}>{format}</option>)}
                  </select>
                </Field>
              </div>
              <Field label={t('automations.webhookHeaders')}>
                <textarea className="rox-autom-textarea rox-autom-mono" rows={3} value={draft.webhookHeaders} onChange={(e) => set({ webhookHeaders: e.target.value })} />
              </Field>
              <Field label={t('automations.webhookBody')}>
                <textarea className="rox-autom-textarea rox-autom-mono" rows={4} value={draft.webhookBody} onChange={(e) => set({ webhookBody: e.target.value })} />
              </Field>
              <Field label={t('automations.webhookAuth')}>
                <select className="rox-autom-select" value={draft.webhookAuthMode} onChange={(e) => set({ webhookAuthMode: e.target.value as Draft['webhookAuthMode'] })}>
                  {automation.actions[0]?.type === 'webhook' && (automation.actions[0].authConfigured || automation.actions[0].auth) && <option value="keep">{t('automations.webhookAuthKeep')}</option>}
                  <option value="none">{t('automations.webhookAuthNone')}</option>
                  <option value="basic">{t('automations.webhookAuthBasic')}</option>
                  <option value="bearer">{t('automations.webhookAuthBearer')}</option>
                </select>
              </Field>
              {automation.actions[0]?.type === 'webhook' && (automation.actions[0].authConfigured || automation.actions[0].auth) && (
                <p className="rox-autom-note">{t('automations.webhookSecretRetained')} {t('automations.webhookSecretRotate')}</p>
              )}
              {draft.webhookAuthMode === 'basic' && (
                <div className="rox-autom-grid">
                  <Field label={t('automations.webhookUsername')}>
                    <input className="rox-autom-input" autoComplete="username" value={draft.webhookUsername} onChange={(e) => set({ webhookUsername: e.target.value })} />
                  </Field>
                  <Field label={t('automations.webhookPassword')}>
                    <input className="rox-autom-input" type="password" autoComplete="new-password" value={draft.webhookPassword} onChange={(e) => set({ webhookPassword: e.target.value })} />
                  </Field>
                </div>
              )}
              {draft.webhookAuthMode === 'bearer' && (
                <Field label={t('automations.webhookToken')}>
                  <input className="rox-autom-input" type="password" autoComplete="new-password" value={draft.webhookToken} onChange={(e) => set({ webhookToken: e.target.value })} />
                </Field>
              )}
              <label className="rox-autom-inline">
                <input type="checkbox" checked={draft.webhookCaptureResponse} onChange={(e) => set({ webhookCaptureResponse: e.target.checked })} />
                {t('automations.webhookCaptureResponse')}
              </label>
            </>
          )}
          <span className="rox-autom-label" style={{ marginTop: 4 }}>{t('automations.targetSession')}</span>
          <div className="rox-autom-grid">
            <Field label={t('automations.labelAccessLevel')}>
              <select className="rox-autom-select" value={draft.permissionMode} onChange={(e) => set({ permissionMode: e.target.value as PermissionMode })}>
                {(['safe', 'ask', 'allow-all'] as PermissionMode[]).map((m) => <option key={m} value={m}>{t(`automations.permission.${m}`)}</option>)}
              </select>
            </Field>
            <Field label={t('automations.labelLabels')}>
              <input className="rox-autom-input" value={draft.labels} placeholder={t('automations.labelsPlaceholder')} onChange={(e) => set({ labels: e.target.value })} />
            </Field>
            <Field label={t('automations.labelTelegramTopic')}>
              <input className="rox-autom-input" value={draft.telegramTopic} placeholder={t('automations.telegramTopicPlaceholder')} onChange={(e) => set({ telegramTopic: e.target.value })} />
            </Field>
          </div>
          <p className="rox-autom-note">{t('automations.targetSessionHint')}</p>
        </Step>

        <RunHistory entries={history} loading={historyLoading} onRefresh={() => void refreshHistory()} />
      </div>
    </div>
  )
}

export default AutomationEditor
