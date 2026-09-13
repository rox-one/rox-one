/**
 * Versioned first-run checkpoint (issue #340).
 * Local profile writes are not account registration.
 */

export const ONBOARDING_CHECKPOINT_VERSION = 1 as const

export const ONBOARDING_STEPS = [
  'welcome',
  'rox-connect',
  'git-bash',
  'provider-select',
  'local-model',
  'credentials',
  'omp-credential',
  'environment',
  'complete',
] as const

export type OnboardingCheckpointStep = (typeof ONBOARDING_STEPS)[number]

export type OnboardingLocalProfile = {
  displayName?: string
}

export type OnboardingAccountAuth = {
  connected: boolean
  provider?: string
}

export type OnboardingCheckpoint = {
  version: typeof ONBOARDING_CHECKPOINT_VERSION
  step: OnboardingCheckpointStep
  skipped: OnboardingCheckpointStep[]
  localProfile?: OnboardingLocalProfile
  accountAuth?: OnboardingAccountAuth
  outcomeId?: string
}

export type OnboardingCheckpointStore = {
  read(): OnboardingCheckpoint | null
  write(checkpoint: OnboardingCheckpoint): void
  clear(): void
}

export function emptyOnboardingCheckpoint(step: OnboardingCheckpointStep = 'welcome'): OnboardingCheckpoint {
  return {
    version: ONBOARDING_CHECKPOINT_VERSION,
    step,
    skipped: [],
  }
}

export function isAccountRegistered(checkpoint: OnboardingCheckpoint): boolean {
  return checkpoint.accountAuth?.connected === true
}

export function parseOnboardingCheckpoint(raw: unknown): OnboardingCheckpoint | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.version !== ONBOARDING_CHECKPOINT_VERSION) return null
  if (typeof value.step !== 'string' || !(ONBOARDING_STEPS as readonly string[]).includes(value.step)) return null
  const skipped = Array.isArray(value.skipped)
    ? value.skipped.filter((step): step is OnboardingCheckpointStep => typeof step === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(step))
    : []
  const checkpoint: OnboardingCheckpoint = {
    version: ONBOARDING_CHECKPOINT_VERSION,
    step: value.step as OnboardingCheckpointStep,
    skipped,
  }
  if (value.localProfile && typeof value.localProfile === 'object') {
    const profile = value.localProfile as Record<string, unknown>
    checkpoint.localProfile = {
      displayName: typeof profile.displayName === 'string' ? profile.displayName : undefined,
    }
  }
  if (value.accountAuth && typeof value.accountAuth === 'object') {
    const auth = value.accountAuth as Record<string, unknown>
    checkpoint.accountAuth = {
      connected: auth.connected === true,
      provider: typeof auth.provider === 'string' ? auth.provider : undefined,
    }
  }
  if (typeof value.outcomeId === 'string') checkpoint.outcomeId = value.outcomeId
  return checkpoint
}

export function decideOnboardingStep(input: {
  requested?: OnboardingCheckpointStep
  checkpoint?: OnboardingCheckpoint | null
  completed?: boolean
}): OnboardingCheckpointStep {
  if (input.completed) return 'complete'
  if (input.requested) return input.requested
  if (input.checkpoint?.step) return input.checkpoint.step
  return 'welcome'
}

export function skipOnboardingStep(
  checkpoint: OnboardingCheckpoint,
  step: OnboardingCheckpointStep,
  next: OnboardingCheckpointStep,
): OnboardingCheckpoint {
  const skipped = checkpoint.skipped.includes(step) ? checkpoint.skipped : [...checkpoint.skipped, step]
  return { ...checkpoint, step: next, skipped }
}

export function memoryOnboardingStore(initial?: OnboardingCheckpoint | null): OnboardingCheckpointStore {
  let current = initial ?? null
  return {
    read: () => (current ? structuredClone(current) : null),
    write: (checkpoint) => {
      current = structuredClone(checkpoint)
    },
    clear: () => {
      current = null
    },
  }
}
