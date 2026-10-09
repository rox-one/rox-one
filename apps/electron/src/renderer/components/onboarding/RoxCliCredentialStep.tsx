/**
 * Single first-run credential step for the seeded Rox CLI path.
 * Reused by the onboarding wizard and the in-chat OMP_NO_MODELS surface.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'

export interface RoxCliCredentialSubmitData {
  apiKey: string
}

interface RoxCliCredentialStepProps {
  onSubmit: (data: RoxCliCredentialSubmitData) => void
  onBack?: () => void
  status?: 'idle' | 'validating' | 'success' | 'error'
  errorMessage?: string
  /** Hide the back button (in-chat overlay). */
  compact?: boolean
  typedCode?: string
}

export function RoxCliCredentialStep({
  onSubmit,
  onBack,
  status = 'idle',
  errorMessage,
  compact = false,
  typedCode = 'OMP_NO_MODELS',
}: RoxCliCredentialStepProps) {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = useState('')
  const isDisabled = status === 'validating'

  const title =
    typedCode === 'OMP_AUTH_REQUIRED'
      ? t('errors.roxCli.authRequired.title')
      : typedCode === 'OMP_NO_MODELS'
        ? t('errors.roxCli.noModels.title')
        : t('onboarding.roxCliCredential.title')
  const description =
    typedCode === 'OMP_AUTH_REQUIRED'
      ? t('errors.roxCli.authRequired.message')
      : typedCode === 'OMP_NO_MODELS'
        ? t('errors.roxCli.noModels.message')
        : t('onboarding.roxCliCredential.description')

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
      title={title}
      description={description}
      actions={
        <>
          {onBack && !compact ? (
            <BackButton onClick={onBack} disabled={isDisabled} />
          ) : null}
          <ContinueButton
            type="submit"
            form="rox-cli-credential-form"
            disabled={isDisabled || !apiKey.trim()}
          >
            {isDisabled ? t('onboarding.completion.settingUp') : t('onboarding.roxCliCredential.submit')}
          </ContinueButton>
        </>
      }
    >
      <form id="rox-cli-credential-form" onSubmit={handleSubmit} className="space-y-4">
        {compact ? (
          <p className="text-xs font-mono text-muted-foreground" data-testid="rox-cli-credential-code">
            {typedCode}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          {t('onboarding.roxCliCredential.howToSupply')}
        </p>
        <div className="space-y-2">
          <Label htmlFor="rox-cli-api-key">{t('onboarding.roxCliCredential.keyLabel')}</Label>
          <Input
            id="rox-cli-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={t('onboarding.roxCliCredential.keyPlaceholder')}
            disabled={isDisabled}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {t('onboarding.roxCliCredential.envHint')}
        </p>
        {errorMessage ? (
          <p className="text-sm text-destructive">{errorMessage}</p>
        ) : null}
      </form>
    </StepFormLayout>
  )
}
