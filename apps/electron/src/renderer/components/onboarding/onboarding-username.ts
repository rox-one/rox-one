/**
 * Onboarding identity: public handle + organization validation, availability
 * state machine, reserved-address derivation, and profile persistence.
 *
 * Everything here is pure so the validation table, the "never green without an
 * explicit available" rule, and the coin-badge gating can be unit-tested
 * without mounting the React step.
 */

/** Public username: 4–16 characters. */
const ONBOARDING_USERNAME_MIN = 4
export const ONBOARDING_USERNAME_MAX = 16
/** Organization slug: 4–32 characters. */
const ONBOARDING_ORGANIZATION_MIN = 4
export const ONBOARDING_ORGANIZATION_MAX = 32
/** Latin letters (either case), digits, `_` and `-` — no spaces. */
const ONBOARDING_HANDLE_PATTERN = /^[A-Za-z0-9_-]+$/
/** Availability is only requested after the field settles for this long. */
export const HANDLE_CHECK_DEBOUNCE_MS = 400

export interface OnboardingCallerIdentity {
  userId: string
  authority: 'native' | 'local'
  issuer?: string
  name?: string
}

export interface OnboardingIdentityApi {
  getOrgIdentity(): Promise<OnboardingCallerIdentity>
  updateOrgIdentity(updates: {
    username?: string
    name?: string
    organization?: string
  }): Promise<unknown>
  identityUpdateProfile?(updates: { displayName: string }): Promise<unknown>
}

/** Optional identity extras persisted best-effort alongside the handle. */
interface OnboardingIdentityExtras {
  organization?: string
  publicHandle?: string
}

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/u

/** Trim + Unicode NFC normalization, mirroring native profile storage. */
export function normalizeHandleInput(raw: string): string {
  return raw.normalize('NFC').trim()
}

function matchesHandle(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && ONBOARDING_HANDLE_PATTERN.test(value)
}

/** Public handle or null when the value violates the contract. Case preserved. */
export function parseOnboardingUsername(raw: string): string | null {
  if (typeof raw !== 'string' || CONTROL_CHARS.test(raw)) return null
  const value = normalizeHandleInput(raw)
  return matchesHandle(value, ONBOARDING_USERNAME_MIN, ONBOARDING_USERNAME_MAX) ? value : null
}

/** Organization slug or null (an empty field is null, never invalid). */
export function parseOnboardingOrganization(raw: string): string | null {
  if (typeof raw !== 'string' || CONTROL_CHARS.test(raw)) return null
  const value = normalizeHandleInput(raw)
  return matchesHandle(value, ONBOARDING_ORGANIZATION_MIN, ONBOARDING_ORGANIZATION_MAX) ? value : null
}

/** Suggested organization shown as a greyed placeholder when the field is empty. */
export function defaultOnboardingOrganization(username: string): string {
  return `${username}_org`
}

/**
 * Effective organization slug: an explicit valid value, or the suggested
 * default when the field is empty and the username is valid. A non-empty but
 * invalid value resolves to null so the UI can flag it.
 */
export function resolveOnboardingOrganization(username: string, rawOrganization: string): string | null {
  const parsedUsername = parseOnboardingUsername(username)
  if (!parsedUsername) return null
  const parsedOrganization = parseOnboardingOrganization(rawOrganization)
  if (parsedOrganization) return parsedOrganization
  const trimmed = normalizeHandleInput(typeof rawOrganization === 'string' ? rawOrganization : '')
  return trimmed.length === 0 ? defaultOnboardingOrganization(parsedUsername) : null
}

// =============================================================================
// AVAILABILITY
// =============================================================================

export type HandleAvailability = 'available' | 'taken' | 'reserved' | 'unknown'
/** Field-level state: the four availability verdicts plus local idle/checking/invalid. */
export type HandleCheckStatus = 'idle' | 'checking' | 'invalid' | HandleAvailability

/**
 * Normalize any server payload into the closed availability set. A body that
 * does not explicitly confirm availability becomes 'unknown' — never
 * 'available'.
 */
export function parseHandleAvailabilityResponse(raw: unknown): HandleAvailability {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown'
  const value = raw as Record<string, unknown>
  if (value.status === 'available' || value.status === 'taken' || value.status === 'reserved') return value.status
  if (value.status === 'unknown' || value.status === 'invalid') return 'unknown'
  if (value.available === true) return 'available'
  if (value.available === false) return value.reason === 'reserved' ? 'reserved' : 'taken'
  return 'unknown'
}

interface HandleAvailabilityTracker {
  /** Start a request for a handle; returns a token identifying this request. */
  begin(handle: string): number
  /** Accept a response only when its token is still the newest; else null. */
  settle(token: number, result: HandleAvailability): HandleAvailability | null
  /** Invalidate every outstanding request (e.g. the field became invalid). */
  invalidate(): void
}

/** Monotonic request guard: stale (out-of-order) responses are dropped. */
export function createHandleAvailabilityTracker(): HandleAvailabilityTracker {
  let token = 0
  return {
    begin: () => ++token,
    settle: (requestToken, result) => (requestToken === token ? result : null),
    invalidate: () => { token++ },
  }
}

// =============================================================================
// RESERVED ADDRESSES + COIN BADGES
// =============================================================================

interface ReservedIdentityAddresses {
  /** e.g. `rox.one/@ada` */
  handle: string
  /** e.g. `rox.one/@ada_org` */
  organization: string
  /** e.g. `ada@rox.one` */
  email: string
}

export function reservedIdentityAddresses(username: string, organizationSlug: string): ReservedIdentityAddresses {
  // Public handles are unique case-insensitively: addresses and the mailbox
  // are always emitted lowercase regardless of how the user typed them.
  const handle = username.toLowerCase()
  const organization = organizationSlug.toLowerCase()
  return {
    handle: `rox.one/@${handle}`,
    organization: `rox.one/@${organization}`,
    email: `${handle}@rox.one`,
  }
}

/** Informational rewards only — the balance itself is never computed client-side. */
export const ROX_COIN_REWARDS = {
  username: 5,
  organization: 5,
  telegram: 15,
  github: 5,
} as const

interface IdentityCoinState {
  username: boolean
  organization: boolean
  telegram: boolean
  github: boolean
}

/** Grey until the matching action completes, gold afterwards. */
export function identityCoinState(params: {
  usernameStatus: HandleCheckStatus
  organizationAccepted: boolean
  telegramLinked: boolean
  githubLinked: boolean
}): IdentityCoinState {
  return {
    username: params.usernameStatus === 'available',
    organization: params.organizationAccepted,
    telegram: params.telegramLinked,
    github: params.githubLinked,
  }
}

/** The green reserved block only ever shows for an explicit 'available'. */
export function shouldShowReservedBlock(status: HandleCheckStatus): boolean {
  return status === 'available'
}

// =============================================================================
// PERSISTENCE
// =============================================================================

/** Save to the authenticated caller's profile and confirm the same identity. */
export async function persistOnboardingUsername(
  api: OnboardingIdentityApi,
  raw: string,
  extras: OnboardingIdentityExtras = {},
): Promise<void> {
  const username = parseOnboardingUsername(raw)
  if (!username) throw new Error('invalid-username')
  const publicHandle = extras.publicHandle ? parseOnboardingUsername(extras.publicHandle) : username
  if (!publicHandle) throw new Error('invalid-username')
  const organization = extras.organization ? parseOnboardingOrganization(extras.organization) : null
  const before = await api.getOrgIdentity()
  if (!before.userId) throw new Error('identity-unavailable')
  const payload = { username: publicHandle, name: username, ...(organization ? { organization } : {}) }
  if (before.authority === 'native') {
    if (!before.issuer) throw new Error('identity-authority-unavailable')
    await api.updateOrgIdentity(payload)
  } else if (before.authority === 'local' && api.identityUpdateProfile) {
    await api.identityUpdateProfile({ displayName: username })
    await api.updateOrgIdentity(payload)
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

/**
 * Where the first run goes after the name screen. 'finish' means straight
 * into the app (the Rox runtime is set as default; no provider picker).
 */
export function nextStepAfterUsername(ctx: UsernameAdvanceContext): 'rox-connect' | 'git-bash' | 'finish' {
  if (ctx.applyRoxConnectGate) return 'rox-connect'
  if (ctx.gitBashMissing) return 'git-bash'
  return 'finish'
}