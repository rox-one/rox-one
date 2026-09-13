import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StepFormLayout, ContinueButton } from './primitives'
import { parseOnboardingUsername } from './onboarding-username'

interface UsernameStepProps {
  onSubmit: (displayName: string) => void
  isLoading?: boolean
}

export function UsernameStep({ onSubmit, isLoading = false }: UsernameStepProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.electronAPI.identityGetState?.().then((state) => {
      if (cancelled) return
      const seeded = state.profile.displayName?.trim()
      if (seeded) setValue(seeded)
    }).catch(() => {
      // Seed is optional — the field stays empty.
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = () => {
    const name = parseOnboardingUsername(value)
    if (!name) {
      setError(true)
      return
    }
    onSubmit(name)
  }

  return (
    <StepFormLayout
      icon={<UserRound />}
      title={t('onboarding.username.title')}
      description={t('onboarding.username.description')}
      actions={
        <ContinueButton
          onClick={handleSubmit}
          className="w-full"
          loading={isLoading}
          loadingText={t('common.checking')}
        >
          {t('onboarding.username.continue')}
        </ContinueButton>
      }
    >
      <div className="w-full space-y-2 text-left">
        <Label htmlFor="onboarding-username">{t('onboarding.username.title')}</Label>
        <Input
          id="onboarding-username"
          autoFocus
          autoComplete="nickname"
          value={value}
          placeholder={t('onboarding.username.placeholder')}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleSubmit()
            }
          }}
          aria-invalid={error}
        />
        {error && (
          <p className="text-xs text-destructive">{t('onboarding.username.required')}</p>
        )}
      </div>
    </StepFormLayout>
  )
}
