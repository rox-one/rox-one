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

/**
 * Where the first run goes after the name screen. 'finish' means straight
 * into the app (the Rox runtime is set as default; no provider picker).
 */
export function nextStepAfterUsername(ctx: UsernameAdvanceContext): 'rox-connect' | 'git-bash' | 'finish' {
  if (ctx.applyRoxConnectGate) return 'rox-connect'
  if (ctx.gitBashMissing) return 'git-bash'
  return 'finish'
}
