/**
 * Single first-run credential step for the seeded OMP / Rox path.
 * Reused by the onboarding wizard and the in-chat OMP_NO_MODELS surface.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'

export interface OmpCredentialSubmitData {
  apiKey: string
}

interface OmpCredentialStepProps {
  onSubmit: (data: OmpCredentialSubmitData) => void
  onBack?: () => void
  status?: 'idle' | 'validating' | 'success' | 'error'
  errorMessage?: string
  /** Hide the back button (in-chat overlay). */
  compact?: boolean
  typedCode?: string
}

export function OmpCredentialStep({
  onSubmit,
  onBack,
  status = 'idle',
  errorMessage,
  compact = false,
  typedCode = 'OMP_NO_MODELS',
}: OmpCredentialStepProps) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const isDisabled = status === 'validating'

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed) return
    onSubmit({ apiKey: trimmed })
  }

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <KeyRound className="size-10 text-accent" />
        </div>
      }
      title={t('onboarding.ompCredential.title')}
      description={t('onboarding.ompCredential.description')}
      actions={
        <>
          {onBack && !compact ? (
            <BackButton onClick={onBack} disabled={isDisabled} />
          ) : null}
          <ContinueButton
            type="submit"
            form="omp-credential-form"
            disabled={isDisabled || !apiKey.trim()}
          >
            {isDisabled ? t('onboarding.completion.settingUp') : t('onboarding.ompCredential.submit')}
          </ContinueButton>
        </>
      }
    >
      <form id="omp-credential-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs font-mono text-muted-foreground" data-testid="omp-credential-code">
          {typedCode}
        </p>
        <p className="text-sm text-muted-foreground">
          {t('onboarding.ompCredential.howToSupply')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="omp-rox-api-key">{t('onboarding.ompCredential.keyLabel')}</Label>
          <Input
            id="omp-rox-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('onboarding.ompCredential.keyPlaceholder')}
            disabled={isDisabled}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('onboarding.ompCredential.envHint')}
        </p>
        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}
      </form>
    </StepFormLayout>
  )
}
