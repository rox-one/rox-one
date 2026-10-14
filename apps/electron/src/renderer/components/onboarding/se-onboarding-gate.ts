import * as React from 'react'
import { KEYS, getKeyString } from '@/lib/local-storage'

export function readSeOnboardingCompleted(): boolean {
  try {
    return localStorage.getItem(getKeyString(KEYS.seOnboardingComplete)) === '1'
  } catch {
    return false
  }
}

export function markSeOnboardingCompleted(): void {
  try {
    localStorage.setItem(getKeyString(KEYS.seOnboardingComplete), '1')
  } catch {
    /* ignore */
  }
}

/**
 * Leaf gate for the Super Engineering onboarding dialog.
 * Kept out of SuperEngineeringOnboardingDialog.tsx so the boot shell can
 * decide whether to show the overlay without evaluating Dialog / Button.
 */
export function useSeOnboardingGate(enabled: boolean): { shouldShow: boolean; dismiss: () => void } {
  const [show, setShow] = React.useState(false)
  React.useEffect(() => {
    if (!enabled) {
      setShow(false)
      return
    }
    setShow(!readSeOnboardingCompleted())
  }, [enabled])
  return {
    shouldShow: show,
    dismiss: () => {
      markSeOnboardingCompleted()
      setShow(false)
    },
  }
}
