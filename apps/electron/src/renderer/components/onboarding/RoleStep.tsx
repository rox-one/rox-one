/**
 * RoleStep — first-run «Who are you?» screen (spec 2026-10-09, D1).
 *
 * Full-width, no page scroll, three cards: who you are (developer + adjacent
 * roles), the tools and formats you work with, and how the agent should
 * answer and collaborate. The answer is saved through the shared
 * onboarding-role module into environment.json; `formatPreferencesForPrompt`
 * turns the work-style part into agent instructions. «Пропустить» is safe and
 * equivalent to «not a developer» without recording an answer.
 */
import { useId, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Star } from 'lucide-react'
import {
  ONBOARDING_OTHER_ROLE_MAX,
  WORK_STYLE_AGENTS,
  WORK_STYLE_FORMATS,
  WORK_STYLE_SCALE_MAX,
  type OnboardingWorkStyle,
  type WorkStyleAgent,
  type WorkStyleFormat,
  type WorkStyleScaleKey,
} from '@rox/shared/environment'
import { BackButton, ContinueButton } from './primitives'
import {
  ONBOARDING_RELATED_ROLES,
  persistOnboardingRole,
  type OnboardingRelatedRole,
} from './onboarding-role'

/** i18n key of each adjacent role chip. */
const roleKey = (role: OnboardingRelatedRole) => `onboarding.role.${role}`

/** Product names are proper nouns; only «other» goes through i18n. */
const AGENT_NAMES: Record<Exclude<WorkStyleAgent, 'other'>, string> = {
  omp: 'OMP',
  opencode: 'OpenCode',
  claudeCode: 'Claude Code',
  codex: 'Codex CLI',
  cursor: 'Cursor',
  geminiCli: 'Gemini CLI',
  antigravity: 'Antigravity CLI',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  chatgpt: 'ChatGPT',
  perplexity: 'Perplexity',
  grok: 'Grok',
  qwen: 'Qwen',
  deepseek: 'DeepSeek',
  gigachat: 'GigaChat',
  zai: 'Z.ai',
  kimi: 'Kimi',
  mistral: 'Mistral',
  copilot: 'Copilot',
  windsurf: 'Windsurf',
  kiloCode: 'Kilo Code',
  cline: 'Cline',
  rooCode: 'Roo Code',
  aider: 'Aider',
}

/** Display order: Rox's own runtimes first, then coding agents, then chat assistants. */
const AGENT_ORDER: readonly WorkStyleAgent[] = ([
  'omp', 'opencode', 'claudeCode', 'codex', 'cursor', 'geminiCli', 'antigravity', 'hermes', 'openclaw',
  'copilot', 'windsurf', 'kiloCode', 'cline', 'rooCode', 'aider',
  'chatgpt', 'perplexity', 'grok', 'qwen', 'deepseek', 'gigachat', 'zai', 'kimi', 'mistral', 'other',
] as const).filter((agent) => (WORK_STYLE_AGENTS as readonly string[]).includes(agent))

const FORMAT_NAMES: Partial<Record<WorkStyleFormat, string>> = {
  pdf: 'PDF',
  pptx: 'PPTX',
  xlsx: 'XLSX',
  docx: 'DOCX',
  json: 'JSON',
  markdown: 'Markdown',
}

/** Slider ends: [left, right] label keys; 0 = left, 10 = right. */
const SCALE_ENDS: Record<WorkStyleScaleKey, readonly [string, string]> = {
  detail: ['onboarding.role.detail.concise', 'onboarding.role.detail.detailed'],
  layout: ['onboarding.role.layout.prose', 'onboarding.role.layout.bullets'],
  tone: ['onboarding.role.tone.reserved', 'onboarding.role.tone.friendly'],
  formality: ['onboarding.role.formality.formal', 'onboarding.role.formality.informal'],
  clarify: ['onboarding.role.clarify.askFirst', 'onboarding.role.clarify.autonomous'],
  collaboration: ['onboarding.role.collaboration.reasonTogether', 'onboarding.role.collaboration.justDeliver'],
}

interface RoleStepProps {
  onContinue: () => void
  onBack?: () => void
  /** First run is still checking Git Bash on Windows. */
  isLoading?: boolean
  /** First run: the default Rox runtime is being applied before the app opens. */
  isFinishing?: boolean
}

function Chip({
  selected,
  label,
  onClick,
  disabled,
  testId,
  trailing,
}: {
  selected: boolean
  label: string
  onClick: () => void
  disabled: boolean
  testId?: string
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex max-w-full items-center gap-1 whitespace-normal break-words rounded-full border px-2.5 py-1 text-left text-xs leading-tight transition-[background-color,border-color,color] motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
        selected
          ? 'border-accent/40 bg-accent/15 font-medium text-foreground shadow-minimal'
          : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
    >
      {label}
      {trailing}
    </button>
  )
}

/**
 * 0–10 slider with a label at each end. Untouched = no preference (the thumb
 * rests dimmed in the middle and nothing is saved); double-click resets.
 */
function Scale({
  scaleKey,
  value,
  onChange,
  disabled,
}: {
  scaleKey: WorkStyleScaleKey
  value: number | undefined
  onChange: (next: number | undefined) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const id = useId()
  const [left, right] = SCALE_ENDS[scaleKey]
  const set = value !== undefined
  const shown = value ?? WORK_STYLE_SCALE_MAX / 2
  const leftLabel = t(left)
  const rightLabel = t(right)
  return (
    <div className="space-y-1" data-testid={`role-scale-${scaleKey}`} data-set={set ? 'true' : 'false'}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <label htmlFor={id} className={cn('transition-colors', set && shown < 5 ? 'font-medium text-foreground' : 'text-muted-foreground')}>{leftLabel}</label>
        <span aria-hidden="true" className={cn('numeric text-caption tabular-nums', set ? 'text-foreground/80' : 'text-muted-foreground/50')}>{set ? shown : '–'}</span>
        <span className={cn('text-right transition-colors', set && shown > 5 ? 'font-medium text-foreground' : 'text-muted-foreground')}>{rightLabel}</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={WORK_STYLE_SCALE_MAX}
        step={1}
        value={shown}
        disabled={disabled}
        aria-valuetext={set ? `${shown} / ${WORK_STYLE_SCALE_MAX}: ${leftLabel} – ${rightLabel}` : t('onboarding.role.scaleUnset')}
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => onChange(undefined)}
        className="onb-range w-full"
        data-set={set ? 'true' : 'false'}
        style={{ ['--onb-range-fill' as string]: `${(shown / WORK_STYLE_SCALE_MAX) * 100}%` }}
      />
    </div>
  )
}

function Card({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId: string }) {
  return (
    <section
      data-testid={testId}
      className="onb-card flex min-h-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border/60 bg-background/30 p-4 lg:overflow-y-auto"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="onb-helper mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </section>
  )
}

function toggle<T>(list: readonly T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]
}

export function RoleStep({ onContinue, onBack, isLoading = false, isFinishing = false }: RoleStepProps) {
  const { t } = useTranslation()
  // null until the user picks: an untouched toggle is not an answer.
  const [isDeveloper, setIsDeveloper] = useState<boolean | null>(null)
  const [relatedRoles, setRelatedRoles] = useState<OnboardingRelatedRole[]>([])
  const [otherRole, setOtherRole] = useState('')
  const otherSelected = relatedRoles.includes('other')
  const [workStyle, setWorkStyle] = useState<OnboardingWorkStyle>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isLoading || isFinishing

  const agents = workStyle.agents ?? []
  const formats = workStyle.formats ?? []

  const scales = workStyle.scales ?? {}
  const setScale = (key: WorkStyleScaleKey, next: number | undefined) => {
    setWorkStyle((current) => {
      const nextScales = { ...(current.scales ?? {}) }
      if (next === undefined) delete nextScales[key]
      else nextScales[key] = next
      const rest: OnboardingWorkStyle = { ...current }
      delete rest.scales
      return Object.keys(nextScales).length > 0 ? { ...rest, scales: nextScales } : rest
    })
  }

  /** Select / deselect a format; the first one picked becomes the primary. */
  const toggleFormat = (format: WorkStyleFormat) => {
    setWorkStyle((current) => {
      const nextList = toggle(current.formats ?? [], format)
      const primary = current.primaryFormat && nextList.includes(current.primaryFormat)
        ? current.primaryFormat
        : nextList[0]
      const rest: OnboardingWorkStyle = { ...current }
      delete rest.formats
      delete rest.primaryFormat
      return {
        ...rest,
        ...(nextList.length > 0 ? { formats: nextList } : {}),
        ...(primary ? { primaryFormat: primary } : {}),
      }
    })
  }
  const makePrimary = (format: WorkStyleFormat) => setWorkStyle((current) => ({ ...current, primaryFormat: format }))

  const submit = async (skipped: boolean) => {
    if (busy) return
    setSaving(true)
    setError(null)
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (!api) throw new Error('environment-unavailable')
      await persistOnboardingRole(api, {
        isDeveloper: skipped ? false : isDeveloper === true,
        ...(skipped || isDeveloper === null ? {} : { isDeveloperExplicit: true }),
        relatedRoles: skipped ? [] : relatedRoles,
        ...(!skipped && otherSelected && otherRole.trim() ? { otherRole } : {}),
        skipped,
        ...(skipped ? {} : { workStyle }),
      })
      onContinue()
    } catch {
      setError(t('onboarding.role.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="onboarding-role-step" className="mx-auto flex w-full flex-col lg:h-full lg:min-h-0">
      <header className="shrink-0 text-center">
        <h1 className="text-lg font-semibold tracking-tight">{t('onboarding.role.title')}</h1>
        <p className="step-description mt-1 text-sm text-muted-foreground">{t('onboarding.role.description')}</p>
      </header>

      <div className="mt-4 grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:items-start">
        <Card testId="role-card-who" title={t('onboarding.role.section.who')}>
          <div className="grid grid-cols-2 gap-1 rounded-full border border-border/60 bg-background/30 p-1" role="group" aria-label={t('onboarding.role.section.who')}>
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={isDeveloper === value}
                disabled={busy}
                data-testid={value ? 'role-developer-yes' : 'role-developer-no'}
                onClick={() => setIsDeveloper(value)}
                className={cn(
                  'min-h-8 whitespace-normal break-words rounded-full px-3 py-1.5 text-xs leading-tight transition-colors motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
                  isDeveloper === value
                    ? 'onb-seg-active bg-foreground text-background font-medium shadow-minimal'
                    : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {t(value ? 'onboarding.role.developerYes' : 'onboarding.role.developerNo')}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="onb-helper text-xs font-medium text-muted-foreground">{t('onboarding.role.relatedLabel')}</p>
            <div className="flex flex-wrap gap-1.5">
              {ONBOARDING_RELATED_ROLES.map((role) => (
                <Chip
                  key={role}
                  testId={`role-related-${role}`}
                  selected={relatedRoles.includes(role)}
                  label={t(roleKey(role))}
                  onClick={() => setRelatedRoles((current) => toggle(current, role))}
                  disabled={busy}
                />
              ))}
            </div>
            {otherSelected ? (
              <input
                type="text"
                data-testid="role-other-input"
                value={otherRole}
                maxLength={ONBOARDING_OTHER_ROLE_MAX}
                onChange={(event) => setOtherRole(event.target.value.slice(0, ONBOARDING_OTHER_ROLE_MAX))}
                placeholder={t('onboarding.role.otherPlaceholder')}
                aria-label={t('onboarding.role.otherPlaceholder')}
                autoFocus
                disabled={busy}
                className="onb-input h-8 w-full rounded-full border border-border/60 bg-background/40 px-3 text-xs outline-none"
              />
            ) : null}
          </div>
        </Card>

        <Card testId="role-card-tools" title={t('onboarding.role.section.agents')}>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_ORDER.map((agent) => (
              <Chip
                key={agent}
                testId={`role-agent-${agent}`}
                selected={agents.includes(agent)}
                label={agent === 'other' ? t('onboarding.role.agent.other') : AGENT_NAMES[agent]}
                onClick={() => setWorkStyle((current) => ({ ...current, agents: toggle(current.agents ?? [], agent) }))}
                disabled={busy}
              />
            ))}
          </div>
          <div className="space-y-2 border-t border-border/40 pt-3" data-testid="role-formats">
            <div>
              <p className="text-sm font-semibold tracking-tight">{t('onboarding.role.section.formats')}</p>
              <p className="onb-helper text-xs text-muted-foreground">{t('onboarding.role.formatsHint')}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {WORK_STYLE_FORMATS.filter((format) => format !== 'docs').map((format) => {
                const isSelected = formats.includes(format)
                const isPrimary = workStyle.primaryFormat === format
                return (
                  <Chip
                    key={format}
                    testId={`role-format-${format}`}
                    selected={isSelected}
                    label={FORMAT_NAMES[format] ?? t(`onboarding.role.format.${format}`)}
                    onClick={() => toggleFormat(format)}
                    disabled={busy}
                    trailing={isPrimary ? (
                      <span data-testid="role-format-primary" className="ml-0.5 rounded-full bg-accent/25 px-1.5 text-[0.625rem] font-semibold uppercase tracking-wide text-foreground">
                        {t('onboarding.role.formatPrimary')}
                      </span>
                    ) : isSelected ? (
                      <span
                        role="button"
                        tabIndex={0}
                        title={t('onboarding.role.formatMakePrimary')}
                        aria-label={t('onboarding.role.formatMakePrimary')}
                        onClick={(event) => { event.stopPropagation(); makePrimary(format) }}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); makePrimary(format) } }}
                        className="ml-0.5 text-muted-foreground hover:text-foreground"
                      >
                        <Star className="size-3" aria-hidden="true" />
                      </span>
                    ) : null}
                  />
                )
              })}
            </div>
          </div>
        </Card>

        <Card testId="role-card-style" title={t('onboarding.role.section.style')} hint={t('onboarding.role.styleHint')}>
          <div className="space-y-2.5">
            <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{t('onboarding.role.section.answers')}</p>
            {(['detail', 'layout', 'tone', 'formality'] as const).map((key) => (
              <Scale key={key} scaleKey={key} value={scales[key]} onChange={(next) => setScale(key, next)} disabled={busy} />
            ))}
          </div>
          <div className="space-y-2.5 border-t border-border/40 pt-3">
            <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">{t('onboarding.role.section.collab')}</p>
            {(['clarify', 'collaboration'] as const).map((key) => (
              <Scale key={key} scaleKey={key} value={scales[key]} onChange={(next) => setScale(key, next)} disabled={busy} />
            ))}
          </div>
        </Card>
      </div>

      {error && <p role="alert" className="mt-3 text-center text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-3">
        {onBack && <BackButton onClick={onBack} disabled={busy} className="onb-secondary flex-none px-5" />}
        <Button
          type="button"
          variant="ghost"
          onClick={() => void submit(true)}
          disabled={busy}
          data-testid="role-skip"
          className="onb-secondary rounded-full px-5"
        >
          {t('onboarding.role.skip')}
        </Button>
        <ContinueButton
          type="button"
          onClick={() => void submit(false)}
          loading={busy}
          className="onb-primary flex-none px-6"
          loadingText={
            saving ? t('common.saving')
              : isLoading ? t('common.checking')
                : t('onboarding.completion.settingUp')
          }
        >
          {t('common.continue')}
        </ContinueButton>
      </div>
    </div>
  )
}
