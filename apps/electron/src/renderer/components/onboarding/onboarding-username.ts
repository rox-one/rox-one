export const ONBOARDING_USERNAME_MAX = 80

export interface OnboardingCallerIdentity {
  userId: string
  authority: 'native' | 'local'
  issuer?: string
  name?: string
}

export interface OnboardingIdentityApi {
  getOrgIdentity(): Promise<OnboardingCallerIdentity>
  updateOrgIdentity(updates: { username?: string; name?: string }): Promise<unknown>
  identityUpdateProfile?(updates: { displayName: string }): Promise<unknown>
}

/** Save to the authenticated caller's profile and confirm the same identity. */
export async function persistOnboardingUsername(api: OnboardingIdentityApi, raw: string): Promise<void> {
  const username = parseOnboardingUsername(raw)
  if (!username) throw new Error('invalid-username')
  const before = await api.getOrgIdentity()
  if (!before.userId) throw new Error('identity-unavailable')
  if (before.authority === 'native') {
    if (!before.issuer) throw new Error('identity-authority-unavailable')
    await api.updateOrgIdentity({ name: username })
  } else if (before.authority === 'local' && api.identityUpdateProfile) {
    await api.identityUpdateProfile({ displayName: username })
    await api.updateOrgIdentity({ username, name: username })
  } else {
    throw new Error('identity-authority-unavailable')
  }
  const after = await api.getOrgIdentity()
  if (after.userId !== before.userId || after.authority !== before.authority
    || after.issuer !== before.issuer || after.name !== username) {
    throw new Error('identity-readback-mismatch')
  }
}

export type UsernameAdvanceContext = {
  applyRoxConnectGate: boolean
  gitBashMissing: boolean
}

export function parseOnboardingUsername(raw: string): string | null {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(raw)) return null
  const name = raw.normalize('NFC').trim().replace(/\s+/gu, ' ')
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
