/**
 * «Who are you?» onboarding step — the profile answer that gates the Developer
 * Space default (spec 2026-10-09, D1, 02-SPEC-foundations §2.1/§2.2/§2.5).
 *
 * The step always shows on first run and has no feature-flag gate. Skip is safe:
 * it counts as «not a developer» for defaults but is not recorded as an answered
 * profile, so soft-signal reminders keep working.
 */
import { getDefaultStore } from 'jotai'
import { answerChoice, type EnvironmentPrefs } from '@rox/shared/environment'
import type { UsernameAdvanceContext } from './onboarding-username'
import { devSpaceEnabledAtom, onboardingRoleAtom } from '@/atoms/dev-space'

export interface OnboardingRoleAnswer {
  isDeveloper: boolean
  relatedRoles: string[]
  skipped: boolean
}

/** Adjacent roles offered alongside the developer question (multi-select). */
export const ONBOARDING_RELATED_ROLES = ['analyst', 'designer', 'product', 'other'] as const
export type OnboardingRelatedRole = (typeof ONBOARDING_RELATED_ROLES)[number]

/** Minimal environment API the step needs; `window.electronAPI` satisfies it. */
export interface OnboardingRoleApi {
  saveEnvironmentSetup(
    patch: Partial<EnvironmentPrefs> & { completeQuestionnaire?: boolean },
  ): Promise<unknown>
}

/** Same shape as the username step — the role step replaces it in the flow. */
export type RoleAdvanceContext = UsernameAdvanceContext

/**
 * Where the first run goes after the role step — the same decisions as
 * `nextStepAfterUsername`: the Rox Connect gate, then Git Bash (Windows),
 * otherwise straight into the app.
 */
export function nextStepAfterRole(ctx: RoleAdvanceContext): 'rox-connect' | 'git-bash' | 'finish' {
  if (ctx.applyRoxConnectGate) return 'rox-connect'
  if (ctx.gitBashMissing) return 'git-bash'
  return 'finish'
}

/** Only an explicit «developer» choice may turn the Developer Space on (D1). */
export function shouldEnableDevSpace(answer: OnboardingRoleAnswer): boolean {
  return !answer.skipped && answer.isDeveloper
}

/**
 * Persist the role answer to the environment profile (`role`) and to the
 * renderer quick-answer key, then apply the Developer Space default.
 *
 * The flag is written only for a first explicit «developer» answer: skip,
 * «not a developer» and a repeated onboarding never overwrite a manual disable.
 */
export async function persistOnboardingRole(
  api: OnboardingRoleApi,
  answer: OnboardingRoleAnswer,
): Promise<void> {
  const profile = { isDeveloper: answer.isDeveloper, relatedRoles: answer.relatedRoles }
  await api.saveEnvironmentSetup({
    role: answer.skipped
      ? { status: 'skipped', value: profile }
      : answerChoice(profile),
  })
  const store = getDefaultStore()
  const previous = store.get(onboardingRoleAtom)
  store.set(onboardingRoleAtom, answer)
  if (shouldEnableDevSpace(answer) && !(previous && !previous.skipped)) {
    store.set(devSpaceEnabledAtom, true)
  }
}