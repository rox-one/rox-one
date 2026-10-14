/**
 * PillsStep — last first-run step (shell-layout): pick and order the top pills
 * by drag-n-drop (keyboard alternative included), or choose no pills at all.
 * Every change is persisted immediately; Continue finishes onboarding.
 */
import { useTranslation } from 'react-i18next'
import { PillsSettings } from '../shell/PillsSettings'
import { BackButton, ContinueButton, StepFormLayout } from './primitives'

interface PillsStepProps {
  onContinue: () => void
  onBack?: () => void
  isFinishing?: boolean
}

export function PillsStep({ onContinue, onBack, isFinishing }: PillsStepProps) {
  const { t } = useTranslation()
  return (
    <StepFormLayout
      title={t('onboarding.pills.title')}
      description={t('onboarding.pills.hint')}
      grow
      actions={
        <>
          {onBack && <BackButton onClick={onBack} disabled={isFinishing} />}
          <ContinueButton type="button" onClick={onContinue} loading={isFinishing} data-onboarding-pills-continue="">
            {t('onboarding.pills.finish')}
          </ContinueButton>
        </>
      }
    >
      <PillsSettings className="text-left" />
    </StepFormLayout>
  )
}
