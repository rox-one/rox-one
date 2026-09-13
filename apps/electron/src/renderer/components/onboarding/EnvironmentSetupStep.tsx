import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import {
  getDefaultEnvironmentPrefs,
  type EnvironmentPrefs,
  type QuestionId,
} from '@craft-agent/shared/environment'
import { StepFormLayout, ContinueButton } from './primitives'
import { EnvironmentFields } from './EnvironmentFields'

interface EnvironmentSetupStepProps {
  onContinue: (prefs: EnvironmentPrefs, completeQuestionnaire: boolean) => void
  onSkip: () => void
}

export function EnvironmentSetupStep({ onContinue, onSkip }: EnvironmentSetupStepProps) {
  const { t } = useTranslation()
  const [prefs, setPrefs] = useState<EnvironmentPrefs>(getDefaultEnvironmentPrefs)
  const [pending, setPending] = useState<QuestionId[] | null>(null)

  const advanced = useRef(false)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.getEnvironmentSetup?.().then((payload) => {
      if (cancelled) return
      setPrefs(payload.prefs)
      setPending(payload.pendingQuestionIds)
      if (payload.pendingQuestionIds.length === 0 && !advanced.current) {
        advanced.current = true
        onContinue(payload.prefs, true)
      }
    }).catch(() => {
      if (!cancelled) setPending([])
    })
    return () => {
      cancelled = true
    }
  }, [onContinue])

  if (pending === null) {
    return (
      <StepFormLayout
        icon={<SlidersHorizontal />}
        title={t('onboarding.environment.title')}
        description={t('onboarding.environment.description')}
      >
        <p role="status" className="text-sm text-muted-foreground" aria-live="polite">
          {t('common.loading')}
        </p>
      </StepFormLayout>
    )
  }

  if (pending.length === 0) {
    return null
  }

  return (
    <StepFormLayout
      icon={<SlidersHorizontal />}
      title={t('onboarding.environment.title')}
      description={t('onboarding.environment.description')}
      actions={
        <>
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {t('onboarding.environment.skip')}
          </button>
          <ContinueButton onClick={() => onContinue(prefs, true)}>
            {t('onboarding.environment.continue')}
          </ContinueButton>
        </>
      }
    >
      <EnvironmentFields
        prefs={prefs}
        pendingOnly
        pendingQuestionIds={pending}
        onChange={(patch) => setPrefs((current) => ({ ...current, ...patch }))}
      />
    </StepFormLayout>
  )
}
