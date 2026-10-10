/**
 * RoleStep — first-run «Who are you?» screen (spec 2026-10-09, D1).
 *
 * Sits between the name screen and the git-bash / rox-connect / finish gates.
 * The answer is saved through the shared onboarding-role module; «Пропустить»
 * is safe and equivalent to «not a developer» without recording an answer.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { BackButton, ContinueButton, StepFormLayout } from './primitives'
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

interface RoleStepProps {
  onContinue: () => void
  onBack?: () => void
  /** First run is still checking Git Bash on Windows. */
  isLoading?: boolean
  /** First run: the default Rox runtime is being applied before the app opens. */
  isFinishing?: boolean
}

function RoleChoice({
  selected,
  label,
  onClick,
  disabled,
}: {
  selected: boolean
  label: string
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
        selected ? 'border-accent bg-accent/10' : 'border-transparent bg-foreground-2 hover:bg-surface-hover',
      )}
    >
      <span className="font-medium">{label}</span>
    </button>
  )
}

export function RoleStep({ onContinue, onBack, isLoading = false, isFinishing = false }: RoleStepProps) {
  const { t } = useTranslation()
  const [isDeveloper, setIsDeveloper] = useState(false)
  const [relatedRoles, setRelatedRoles] = useState<OnboardingRelatedRole[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = saving || isLoading || isFinishing

  const toggleRelatedRole = (role: OnboardingRelatedRole) => {
    setRelatedRoles((current) =>
      current.includes(role) ? current.filter((entry) => entry !== role) : [...current, role],
    )
  }

  const submit = async (skipped: boolean) => {
    if (busy) return
    setSaving(true)
    setError(null)
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI : undefined
      if (!api) throw new Error('environment-unavailable')
      await persistOnboardingRole(api, {
        isDeveloper: skipped ? false : isDeveloper,
        relatedRoles: skipped ? [] : relatedRoles,
        skipped,
      })
      onContinue()
    } catch {
      setError(t('onboarding.role.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <StepFormLayout
      title={t('onboarding.role.title')}
      description={t('onboarding.role.description')}
      actions={
        <>
          {onBack && <BackButton onClick={onBack} disabled={busy} />}
          <ContinueButton
            type="button"
            onClick={() => void submit(false)}
            loading={busy}
            loadingText={
              saving ? t('common.saving')
                : isLoading ? t('common.checking')
                  : t('onboarding.completion.settingUp')
            }
          >
            {t('common.continue')}
          </ContinueButton>
          <Button
            type="button"
            variant="ghost"
            onClick={() => void submit(true)}
            disabled={busy}
            className="flex-1 max-w-[320px] bg-foreground-2 shadow-minimal text-foreground hover:bg-surface-hover rounded-lg"
          >
            {t('onboarding.role.skip')}
          </Button>
        </>
      }
    >
      <div className="space-y-5 text-left">
        <div className="grid grid-cols-2 gap-2">
          <RoleChoice
            selected={isDeveloper}
            label={t('onboarding.role.developerYes')}
            onClick={() => setIsDeveloper(true)}
            disabled={busy}
          />
          <RoleChoice
            selected={!isDeveloper}
            label={t('onboarding.role.developerNo')}
            onClick={() => setIsDeveloper(false)}
            disabled={busy}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">{t('onboarding.role.relatedLabel')}</p>
          <div className="flex flex-wrap gap-2">
            {ONBOARDING_RELATED_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                aria-pressed={relatedRoles.includes(role)}
                disabled={busy}
                onClick={() => toggleRelatedRole(role)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  relatedRoles.includes(role)
                    ? 'border-accent bg-accent/10 text-foreground'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-surface-hover',
                )}
              >
                {t(RELATED_ROLE_KEYS[role])}
              </button>
            ))}
          </div>
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      </div>
    </StepFormLayout>
  )
}