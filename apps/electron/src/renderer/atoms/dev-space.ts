/**
 * Developer Space renderer state (spec 2026-10-09, D1/D2) — the master
 * `devspace.v1` flag plus the onboarding-role answer, reminder bookkeeping and
 * the one-shot nudge. Mirrors `atoms/entities-links.ts` / `atoms/mode-flags.ts`
 * (atomWithStorage + KEYS + getKeyString). The master flag defaults OFF and is
 * only turned on by an explicit user action (role step / Settings) — a soft
 * signal never enables it (spec §2.4).
 */
import { atomWithStorage } from 'jotai/utils'
import { WORKBENCH_FLAG } from '@rox/core/platform'
import { KEYS, getKeyString } from '@/lib/local-storage'
import type { OnboardingRoleAnswer } from '@/components/onboarding/onboarding-role'

export const DEV_SPACE_FLAG_ID = WORKBENCH_FLAG.devSpaceV1

const opts = { getOnInit: true } as const

/** Master switch for the Developer Space surface (`devspace.v1`). Default OFF. */
export const devSpaceEnabledAtom = atomWithStorage<boolean>(
  getKeyString(KEYS.devSpaceV1),
  false,
  undefined,
  opts,
)

/** Answer of the onboarding «Who are you?» step; null = not answered yet. */
export const onboardingRoleAtom = atomWithStorage<OnboardingRoleAnswer | null>(
  getKeyString(KEYS.onboardingRole),
  null,
  undefined,
  opts,
)

export interface DevSpaceReminderState {
  dismissedUntil?: number
  lastShownAt?: number
  count: number
}

/** «Soft signal» reminder bookkeeping (spec §2.4) — keeps the nudge unobtrusive. */
export const devSpaceReminderStateAtom = atomWithStorage<DevSpaceReminderState>(
  getKeyString(KEYS.devSpaceReminderState),
  { count: 0 },
  undefined,
  opts,
)

/** One-shot nudge: null = not decided yet, true = seen, false = dismissed. */
export const devSpaceNudgeSeenAtom = atomWithStorage<boolean | null>(
  getKeyString(KEYS.devSpaceNudge),
  null,
  undefined,
  opts,
)