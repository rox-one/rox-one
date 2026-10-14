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
import {
  WORK_STYLE_AGENTS,
  WORK_STYLE_FORMATS,
  type OnboardingWorkStyle,
  type WorkStyleAgent,
  type WorkStyleFormat,
} from '@rox/shared/environment'
import { BackButton, ContinueButton } from './primitives'
import {
  ONBOARDING_RELATED_ROLES,
  persistOnboardingRole,
  type OnboardingRelatedRole,
} from './onboarding-role'

const RELATED_ROLE_KEYS: Record<OnboardingRelatedRole, string> = {
  analyst: 'onboarding.role.analyst',
  designer: 'onboarding.role.designer',
  product: 'onboarding.role.product',
  other: 'onboarding.role.other',
}

/** Product names are proper nouns; only «other» goes through i18n. */
const AGENT_NAMES: Record<Exclude<WorkStyleAgent, 'other'>, string> = {
  claudeCode: 'Claude Code CLI',
  codex: 'Codex CLI',
  opencode: 'opencode',
  omp: 'omp',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  cursor: 'Cursor',
  geminiCli: 'Gemini CLI',
}

const FORMAT_NAMES: Partial<Record<WorkStyleFormat, string>> = {
  pdf: 'PDF',
  pptx: 'PPTX',
  xlsx: 'XLSX',
  markdown: 'Markdown',
}

type PairKey = 'detail' | 'layout' | 'clarify' | 'collaboration'
const PAIRS: Record<PairKey, readonly [string, string]> = {
  detail: ['detailed', 'concise'],
  layout: ['prose', 'bullets'],
  clarify: ['askFirst', 'autonomous'],
  collaboration: ['reasonTogether', 'justDeliver'],
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
}: {
  selected: boolean
  label: string
  onClick: () => void
  disabled: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'max-w-full whitespace-normal break-words rounded-full border px-3 py-1.5 text-left text-body leading-tight transition-[background-color,border-color,color] motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
        selected
          ? 'border-accent/40 bg-accent/15 font-medium text-foreground shadow-minimal'
          : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-surface-hover hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

/** Two-option switch; clicking the active option clears it («no preference»). */
function Segmented({
  label,
  options,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  value: string | undefined
  onChange: (next: string | undefined) => void
  disabled: boolean
  testId: string
}) {
  const labelId = useId()
  return (
    <div className="space-y-1">
    <p id={labelId} className="text-caption font-medium uppercase tracking-wide text-muted-foreground/80">{label}</p>
    <div role="group" aria-labelledby={labelId} data-testid={testId} className="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-background/30 p-1">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            data-value={option.value}
            onClick={() => onChange(selected ? undefined : option.value)}
            className={cn(
              'min-h-8 whitespace-normal break-words rounded-md px-3 py-1.5 text-body leading-tight transition-colors motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
              selected
                ? 'bg-foreground text-background font-medium shadow-minimal'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
    </div>
  )
}

function Card({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId: string }) {
  return (
    <section
      data-testid={testId}
      className="flex min-h-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border/60 bg-background/30 p-4 lg:overflow-y-auto"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
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
  const [workStyle, setWorkStyle] = useState<OnboardingWorkStyle>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isLoading || isFinishing

  const agents = workStyle.agents ?? []
  const formats = workStyle.formats ?? []

  const setPair = (key: PairKey, next: string | undefined) => {
    setWorkStyle((current) => {
      const copy: Record<string, unknown> = { ...current }
      if (next === undefined) delete copy[key]
      else copy[key] = next
      return copy as OnboardingWorkStyle
    })
  }

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

  const pair = (key: PairKey) => (
    <Segmented
      label={t(`onboarding.role.pair.${key}`)}
      testId={`role-pair-${key}`}
      options={PAIRS[key].map((value) => ({ value, label: t(`onboarding.role.${key}.${value}`) }))}
      value={workStyle[key]}
      onChange={(next) => setPair(key, next)}
      disabled={busy}
    />
  )

  return (
    <div data-testid="onboarding-role-step" className="mx-auto flex w-full flex-col lg:h-full lg:min-h-0">
      <header className="shrink-0 text-center">
        <h1 className="text-lg font-semibold tracking-tight">{t('onboarding.role.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('onboarding.role.description')}</p>
      </header>

      <div className="mt-5 grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-3 lg:content-start">
        <Card testId="role-card-who" title={t('onboarding.role.section.who')}>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-background/30 p-1" role="group" aria-label={t('onboarding.role.section.who')}>
            {[true, false].map((value) => (
              <button
                key={String(value)}
                type="button"
                aria-pressed={isDeveloper === value}
                disabled={busy}
                data-testid={value ? 'role-developer-yes' : 'role-developer-no'}
                onClick={() => setIsDeveloper(value)}
                className={cn(
                  'min-h-8 whitespace-normal break-words rounded-md px-3 py-1.5 text-body leading-tight transition-colors motion-reduce:transition-none',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/55',
                  isDeveloper === value
                    ? 'bg-foreground text-background font-medium shadow-minimal'
                    : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                )}
              >
                {t(value ? 'onboarding.role.developerYes' : 'onboarding.role.developerNo')}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{t('onboarding.role.relatedLabel')}</p>
            <div className="flex flex-wrap gap-1.5">
              {ONBOARDING_RELATED_ROLES.map((role) => (
                <Chip
                  key={role}
                  selected={relatedRoles.includes(role)}
                  label={t(RELATED_ROLE_KEYS[role])}
                  onClick={() => setRelatedRoles((current) => toggle(current, role))}
                  disabled={busy}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card testId="role-card-tools" title={t('onboarding.role.section.agents')} hint={t('onboarding.role.agentsHint')}>
          <div className="flex flex-wrap gap-1.5">
            {WORK_STYLE_AGENTS.map((agent) => (
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
          <div className="space-y-2 pt-1">
            <p className="text-xs font-medium text-muted-foreground">{t('onboarding.role.section.formats')}</p>
            <div className="flex flex-wrap gap-1.5">
              {WORK_STYLE_FORMATS.map((format) => (
                <Chip
                  key={format}
                  testId={`role-format-${format}`}
                  selected={formats.includes(format)}
                  label={FORMAT_NAMES[format] ?? t(`onboarding.role.format.${format}`)}
                  onClick={() => setWorkStyle((current) => ({ ...current, formats: toggle(current.formats ?? [], format) }))}
                  disabled={busy}
                />
              ))}
            </div>
          </div>
        </Card>

        <Card testId="role-card-style" title={t('onboarding.role.section.style')} hint={t('onboarding.role.styleHint')}>
          <div className="space-y-2">
            <p className="text-body font-semibold text-foreground">{t('onboarding.role.section.answers')}</p>
            {pair('detail')}
            {pair('layout')}
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-body font-semibold text-foreground">{t('onboarding.role.section.collab')}</p>
            {pair('clarify')}
            {pair('collaboration')}
          </div>
        </Card>
      </div>

      {error && <p role="alert" className="mt-3 text-center text-sm text-destructive">{error}</p>}

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-end gap-3">
        {onBack && <BackButton onClick={onBack} disabled={busy} className="flex-none" />}
        <Button
          type="button"
          variant="ghost"
          onClick={() => void submit(true)}
          disabled={busy}
          data-testid="role-skip"
          className="bg-foreground-2 shadow-minimal text-foreground hover:bg-surface-hover rounded-lg"
        >
          {t('onboarding.role.skip')}
        </Button>
        <ContinueButton
          type="button"
          onClick={() => void submit(false)}
          loading={busy}
          className="flex-none"
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
