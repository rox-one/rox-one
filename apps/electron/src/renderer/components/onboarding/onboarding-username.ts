import type { OnboardingStep } from './OnboardingWizard'

export const ONBOARDING_USERNAME_MAX = 80

export type UsernameAdvanceContext = {
  applyRoxConnectGate: boolean
  gitBashMissing: boolean
}

export function parseOnboardingUsername(raw: string): string | null {
  const name = raw.trim()
  if (name.length < 1 || name.length > ONBOARDING_USERNAME_MAX) return null
  return name
}

export function nextStepAfterUsername(ctx: UsernameAdvanceContext): OnboardingStep {
  if (ctx.applyRoxConnectGate) return 'rox-connect'
  if (ctx.gitBashMissing) return 'git-bash'
  return 'provider-select'
}
