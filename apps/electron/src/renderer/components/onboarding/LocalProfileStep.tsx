import { useEffect, useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, UserRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ContinueButton, StepFormLayout } from './primitives'

export interface LocalProfileSubmitData {
  displayName: string
}

interface LocalProfileStepProps {
  initialDisplayName?: string
  status?: 'idle' | 'waiting' | 'success' | 'error'
  errorMessage?: string
  onSubmit: (data: LocalProfileSubmitData) => void
  onConnectCloud?: () => void
}

/**
 * Offline-only profile fallback. Product onboarding enters Rox Connect first
 * whenever a Rox account is required; this screen never claims cloud sign-in.
 */
export function LocalProfileStep({
  initialDisplayName,
  status = 'idle',
  errorMessage,
  onSubmit,
  onConnectCloud,
}: LocalProfileStepProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const trimmedName = displayName.trim()
  const isBusy = status === 'waiting'

  useEffect(() => {
    if (initialDisplayName) setDisplayName(initialDisplayName)
  }, [initialDisplayName])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!trimmedName || isBusy) return
    onSubmit({ displayName: trimmedName })
  }

  return (
    <StepFormLayout
      className="max-w-[30rem]"
      iconElement={
        <div className="flex size-16 items-center justify-center rounded-[20px] border border-accent/30 bg-accent/10 shadow-tinted">
          <UserRound className="size-8 text-accent" />
        </div>
      }
      title={t('onboarding.localProfile.title')}
      description={t('onboarding.localProfile.description')}
      actions={
        <ContinueButton
          type="submit"
          form="local-profile-form"
          disabled={isBusy || !trimmedName}
          loading={isBusy}
          loadingText={t('common.saving')}
          className="max-w-none bg-foreground text-background hover:bg-foreground/90"
        >
          {t('onboarding.localProfile.submit')}
        </ContinueButton>
      }
    >
      <form id="local-profile-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{t('onboarding.localProfile.displayName')}</Label>
          <Input
            id={inputId}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t('onboarding.localProfile.displayNamePlaceholder')}
            autoComplete="name"
            autoFocus
            disabled={isBusy}
            aria-invalid={!trimmedName}
            className="h-11 rounded-xl border-foreground/15 bg-background/70 px-4 text-base shadow-minimal"
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {trimmedName ? t('onboarding.localProfile.displayNameHelper') : t('onboarding.localProfile.displayNameRequired')}
          </p>
        </div>

        {onConnectCloud ? (
          <button
            type="button"
            onClick={onConnectCloud}
            className="flex w-full items-center justify-between rounded-xl border border-foreground/12 bg-background/45 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span>{t('onboarding.roxConnect.connect')}</span>
            <Cloud className="size-4" />
          </button>
        ) : null}

        {errorMessage ? (
          <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </p>
        ) : null}
      </form>
    </StepFormLayout>
  )
}
