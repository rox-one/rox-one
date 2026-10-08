import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SuperEngineeringOnboarding, type SeOnboardingStepId } from './SuperEngineeringOnboarding'
import { KEYS, getKeyString } from '@/lib/local-storage'

const STEPS: SeOnboardingStepId[] = ['welcome', 'harness', 'sidebar', 'workspace']

function readCompleted(): boolean {
  try {
    return localStorage.getItem(getKeyString(KEYS.seOnboardingComplete)) === '1'
  } catch {
    return false
  }
}

function markCompleted(): void {
  try {
    localStorage.setItem(getKeyString(KEYS.seOnboardingComplete), '1')
  } catch {
    /* ignore */
  }
}

export interface SuperEngineeringOnboardingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SuperEngineeringOnboardingDialog({ open, onOpenChange }: SuperEngineeringOnboardingDialogProps) {
  const { t } = useTranslation()
  const [stepIndex, setStepIndex] = React.useState(0)
  const step = STEPS[stepIndex] ?? 'welcome'

  const finish = React.useCallback(() => {
    markCompleted()
    onOpenChange(false)
  }, [onOpenChange])

  const onNext = () => {
    if (stepIndex >= STEPS.length - 1) {
      finish()
      return
    }
    setStepIndex((i) => i + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="se-onboarding-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('se.onboarding.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('se.onboarding.dialogDesc')}</DialogDescription>
        </DialogHeader>
        <SuperEngineeringOnboarding step={step} showHeader={step !== 'welcome'} />
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={finish}>
            {t('se.onboarding.skip')}
          </Button>
          <Button type="button" onClick={onNext}>
            {stepIndex >= STEPS.length - 1 ? t('common.done') : t('common.continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function useSeOnboardingGate(enabled: boolean): { shouldShow: boolean; dismiss: () => void } {
  const [show, setShow] = React.useState(false)
  React.useEffect(() => {
    if (!enabled) {
      setShow(false)
      return
    }
    setShow(!readCompleted())
  }, [enabled])
  return {
    shouldShow: show,
    dismiss: () => {
      markCompleted()
      setShow(false)
    },
  }
}
