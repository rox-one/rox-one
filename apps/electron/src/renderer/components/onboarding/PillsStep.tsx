/**
 * PillsStep — last first-run step (shell-layout): pick and order the top pills
 * on a live miniature of the real titlebar (drag sideways, × to remove, add
 * from the screens below), or choose no pills at all. Every change is
 * persisted immediately; «Готово» finishes onboarding.
 */
import { useTranslation } from 'react-i18next'
import { PillsTopBarSettings } from '../shell/PillsSettings'
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
      className="max-w-[44rem]"
      actions={
        <>
          {onBack && <BackButton onClick={onBack} disabled={isFinishing} className="onb-secondary max-w-[220px] rounded-full" />}
          <ContinueButton type="button" onClick={onContinue} loading={isFinishing} data-onboarding-pills-continue="" className="onb-primary max-w-[220px] px-6">
            {t('onboarding.pills.finish')}
          </ContinueButton>
        </>
      }
    >
      <PillsTopBarSettings className="text-left" />
    </StepFormLayout>
  )
}
