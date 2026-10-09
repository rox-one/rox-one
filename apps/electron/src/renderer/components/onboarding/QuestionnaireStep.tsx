/**
 * QuestionnaireStep — the second screen of the redesigned first run.
 *
 * Two columns: the profile questionnaire plus the six adaptive interest-bubble
 * clouds on the left, the permissions & modes column on the right. The footer
 * holds «Продолжить» (filled, gated on both columns) and «Заполнить позже».
 *
 * The step is standalone: questionnaire/bubble/permission values arrive
 * through props (the parent owns storage), the reward ledger is injected, and
 * «А предложи сам?» degrades honestly to a `no-provider` error when no
 * transport is available. Skip applies the preselected permissions and awards
 * every step as `deferred` (capped at +1); Continue awards the full amounts and
 * the one-time +50 full-onboarding bonus on a complete first pass.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronsRight, CornerDownLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMac, isWindows } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import { CoinsBurst } from './CoinsBurst'
import { InterestBubbles } from './InterestBubbles'
import { PermissionsColumn, isPermissionsColumnComplete } from './PermissionsColumn'
import { ProfileQuestionnaireColumn } from './ProfileQuestionnaireColumn'
import { trackLearningEvent } from './learning-curve'
import { BUBBLE_GROUP_IDS, type BubbleGroupId } from './bubbles-catalog'
import {
  createDefaultProfileQuestionnaire,
  serializeProfileQuestionnaire,
  isProfileQuestionnaireComplete,
  type ProfileQuestionnaire,
  type ProfileQuestionnaireJson,
} from './profile-questionnaire-model'
import {
  initialPermissionsState,
  setPermissionEnabled,
  mergeProbeStatuses,
  entriesForPlatform,
  type PermissionId,
  type PermissionPlatform,
  type PermissionState,
} from './permissions-model'
import {
  FULL_ONBOARDING_BONUS_STEP,
  createRewardLedger,
  type AwardSource,
  type RewardEntry,
  type RewardLedger,
} from './onboarding-rewards'
import type { SuggestPreferencesInput } from '@rox/shared/protocol'
import type {
  OnboardingPermissionKey,
  OnboardingPermissionsStatusSnapshot,
} from '../../../shared/types'

export type BubbleSelections = Record<BubbleGroupId, string[]>

/** Every bubble group starts empty; selections are additive. */
export const EMPTY_BUBBLE_SELECTIONS: BubbleSelections = BUBBLE_GROUP_IDS.reduce(
  (acc, id) => {
    acc[id] = []
    return acc
  },
  {} as BubbleSelections,
)

/** Steps the identity/link screens can have earned before the questionnaire. */
export const DEFAULT_QUESTIONNAIRE_REWARD_STEPS: readonly string[] = ['username', 'org']

/**
 * Permission ids the host bridge can open a system settings pane for. Windows
 * equivalents and app-managed modes have no OS pane, so they are absent.
 */
const OS_GRANTABLE_PERMISSION_KEYS: Partial<Record<PermissionId, OnboardingPermissionKey>> = {
  fullDiskAccess: 'fullDiskAccess',
  automation: 'automation',
  accessibility: 'accessibility',
  screenRecording: 'screenRecording',
  audioRecording: 'audioRecording',
  inputMonitoring: 'inputMonitoring',
}

export interface QuestionnaireStepPayload {
  questionnaire: ProfileQuestionnaireJson
  bubbles: BubbleSelections
  permissions: PermissionState
}

export interface QuestionnaireStepProps {
  onContinue: (payload: QuestionnaireStepPayload) => void
  onSkip: (payload: QuestionnaireStepPayload) => void
  questionnaire?: ProfileQuestionnaire
  onQuestionnaireChange?: (value: ProfileQuestionnaire) => void
  bubbles?: BubbleSelections
  onBubblesChange?: (bubbles: BubbleSelections) => void
  permissions?: PermissionState
  onPermissionsChange?: (state: PermissionState) => void
  platform?: PermissionPlatform
  /** Returns the suggested preferences text; wired by the parent/host. */
  suggestPreferences?: (value: ProfileQuestionnaire) => Promise<string>
  /** Injected reward ledger; a localStorage-backed one is created otherwise. */
  rewards?: RewardLedger
  /** Steps awarded before this screen; deferred (+1 each) when skipped. */
  rewardSteps?: readonly string[]
  onAwardConfirmed?: (entries: RewardEntry[]) => void
  className?: string
}

function detectPlatform(): PermissionPlatform {
  if (isWindows) return 'win'
  if (isMac) return 'mac'
  // User-agent fallback for environments where navigator.platform is absent.
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent?.toLowerCase() ?? ''
  if (ua.includes('windows')) return 'win'
  if (ua.includes('mac os')) return 'mac'
  return 'other'
}

function defaultSuggestTransport(): (value: ProfileQuestionnaire) => Promise<string> {
  return async (value) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || typeof api.suggestPreferences !== 'function') throw new Error('no-provider')
    const input: SuggestPreferencesInput = {
      name: value.fullName,
      birthDate: value.birthDate,
      interfaceLanguage: value.uiLanguage,
      communicationLanguage: value.chatLanguage,
      city: value.city,
      timezone: value.timeZone,
      preferences: value.preferences,
    }
    const result = await api.suggestPreferences(input)
    if (result && result.ok) return result.text
    throw new Error(result && result.reason ? result.reason : 'error')
  }
}

/** Apply the preselected defaults for every not-yet-decided permission row. */
function applyPreselectedPermissions(state: PermissionState): PermissionState {
  let next = state
  for (const entry of entriesForPlatform(state.platform)) {
    if (next.enabled[entry.id] === undefined) {
      next = setPermissionEnabled(next, entry.id, entry.defaultOn)
    }
  }
  return next
}

export function QuestionnaireStep({
  onContinue,
  onSkip,
  questionnaire,
  onQuestionnaireChange,
  bubbles,
  onBubblesChange,
  permissions,
  onPermissionsChange,
  platform,
  suggestPreferences,
  rewards,
  rewardSteps = DEFAULT_QUESTIONNAIRE_REWARD_STEPS,
  onAwardConfirmed,
  className,
}: QuestionnaireStepProps) {
  const { t, i18n } = useTranslation()
  const resolvedPlatform = platform ?? detectPlatform()

  const [internalQuestionnaire, setInternalQuestionnaire] = useState<ProfileQuestionnaire>(
    () => questionnaire ?? createDefaultProfileQuestionnaire(),
  )
  const [internalBubbles, setInternalBubbles] = useState<BubbleSelections>(
    () => bubbles ?? EMPTY_BUBBLE_SELECTIONS,
  )
  const [internalPermissions, setInternalPermissions] = useState<PermissionState>(
    () => permissions ?? initialPermissionsState(resolvedPlatform),
  )
  const [burst, setBurst] = useState<{ count: number; reason: string } | null>(null)
  const trackedSaw = useRef(false)

  const value = questionnaire ?? internalQuestionnaire
  const selection = bubbles ?? internalBubbles
  const permissionState = permissions ?? internalPermissions
  // Latest permission state, read by the async host probe without re-subscribing.
  const permissionStateRef = useRef(permissionState)
  permissionStateRef.current = permissionState

  const ledger = useMemo(
    () =>
      rewards ??
      createRewardLedger({
        storage:
          typeof localStorage !== 'undefined'
            ? localStorage
            : { getItem: () => null, setItem: () => {} },
      }),
    [rewards],
  )

  useEffect(() => {
    if (trackedSaw.current) return
    trackedSaw.current = true
    trackLearningEvent({ name: 'saw', stepId: 'questionnaire', source: 'human' })
  }, [])

  const setQuestionnaire = (next: ProfileQuestionnaire) => {
    trackLearningEvent({ name: 'tried', stepId: 'questionnaire', source: 'human' })
    if (!questionnaire) setInternalQuestionnaire(next)
    onQuestionnaireChange?.(next)
  }

  const setBubbles = (next: BubbleSelections) => {
    trackLearningEvent({ name: 'tried', stepId: 'questionnaire', source: 'human' })
    if (!bubbles) setInternalBubbles(next)
    onBubblesChange?.(next)
  }

  // Bridge-driven updates (host probes) are not user intent, so they skip the
  // `tried` signal. Grants merge independently of the `enabled` toggles.
  const commitPermissions = (next: PermissionState) => {
    if (!permissions) setInternalPermissions(next)
    onPermissionsChange?.(next)
  }

  const mergeProbe = (snapshot: OnboardingPermissionsStatusSnapshot | null | undefined) => {
    if (!snapshot || !snapshot.statuses) return
    commitPermissions(mergeProbeStatuses(permissionStateRef.current, snapshot.statuses))
  }

  const setPermissions = (next: PermissionState) => {
    trackLearningEvent({ name: 'tried', stepId: 'questionnaire', source: 'human' })
    commitPermissions(next)
  }

  // Hydrate the OS-reported statuses once on mount, when a host bridge exists.
  // Absent bridge or a failed probe leaves the honest not-determined defaults.
  useEffect(() => {
    let cancelled = false
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || typeof api.getOnboardingPermissionsStatus !== 'function') return
    void api
      .getOnboardingPermissionsStatus()
      .then((snapshot) => {
        if (!cancelled) mergeProbe(snapshot)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // Mount-only hydration; the bridge is optional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRequestGrant = (id: PermissionId) => {
    const api = typeof window !== 'undefined' ? window.electronAPI : undefined
    if (!api || typeof api.openOnboardingPermissionSettings !== 'function') return
    // Only OS-grantable ids exist on the bridge; Windows/app-toggle rows have
    // no OS settings pane, so they resolve to nothing just as before.
    const key = OS_GRANTABLE_PERMISSION_KEYS[id]
    if (!key) return
    void api
      .openOnboardingPermissionSettings(key)
      .then((result) => (result && result.opened ? api.getOnboardingPermissionsStatus?.() : undefined))
      .then((snapshot) => mergeProbe(snapshot))
      .catch(() => {})
  }

  const suggest = useMemo(
    () => suggestPreferences ?? defaultSuggestTransport(),
    [suggestPreferences],
  )

  const profileComplete = isProfileQuestionnaireComplete(value)
  const permissionsComplete = isPermissionsColumnComplete(permissionState)
  const complete = profileComplete && permissionsComplete

  const deepRanked = selection.professionalInterests ?? []

  const settleRewards = (source: AwardSource, fullPass: boolean): RewardEntry[] => {
    const confirmed: RewardEntry[] = []
    const settleOne = (stepId: string) => {
      ledger.awardStep(stepId, source)
      const entry = ledger.confirmStep(stepId)
      if (entry) confirmed.push(entry)
    }
    for (const stepId of rewardSteps) settleOne(stepId)
    if (source === 'completed' && fullPass) settleOne(FULL_ONBOARDING_BONUS_STEP)
    return confirmed
  }

  const buildPayload = (permissionSnapshot: PermissionState): QuestionnaireStepPayload => ({
    questionnaire: serializeProfileQuestionnaire(value),
    bubbles: selection,
    permissions: permissionSnapshot,
  })

  const handleContinue = () => {
    const confirmed = settleRewards('completed', complete)
    onAwardConfirmed?.(confirmed)
    const total = confirmed.reduce((sum, entry) => sum + entry.amount, 0)
    if (total > 0) setBurst({ count: total, reason: complete ? FULL_ONBOARDING_BONUS_STEP : rewardSteps[0] ?? 'username' })
    trackLearningEvent({ name: 'result', stepId: 'questionnaire', source: 'human' })
    onContinue(buildPayload(permissionState))
  }

  const handleSkip = () => {
    // Skip applies the preselected permissions before deferring the rewards.
    const withDefaults = applyPreselectedPermissions(permissionState)
    if (withDefaults !== permissionState) setPermissions(withDefaults)
    const confirmed = settleRewards('deferred', false)
    onAwardConfirmed?.(confirmed)
    const total = confirmed.reduce((sum, entry) => sum + entry.amount, 0)
    if (total > 0) setBurst({ count: total, reason: 'deferred' })
    trackLearningEvent({ name: 'result', stepId: 'questionnaire', source: 'human' })
    onSkip(buildPayload(withDefaults))
  }

  return (
    <div
      data-testid="onboarding-questionnaire-step"
      className={cn('mx-auto w-full max-w-5xl px-6 py-8', className)}
    >
      <header className="text-center">
        <h1 className="text-lg font-semibold tracking-tight">{t('onboarding.questionnaire.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('onboarding.questionnaire.description')}</p>
      </header>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <div className="space-y-6">
          <ProfileQuestionnaireColumn
            value={value}
            onChange={setQuestionnaire}
            onSuggest={() => suggest(value)}
          />

          <div className="space-y-5">
            {BUBBLE_GROUP_IDS.map((groupId) => (
              <InterestBubbles
                key={groupId}
                groupId={groupId}
                selected={selection[groupId] ?? []}
                onChange={(next) => setBubbles({ ...selection, [groupId]: next })}
                {...(groupId === 'deepInterests' ? { rankedIds: deepRanked } : {})}
                locale={i18n?.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'}
              />
            ))}
          </div>
        </div>

        <PermissionsColumn
          platform={resolvedPlatform}
          state={permissionState}
          onStateChange={setPermissions}
          onRequestGrant={handleRequestGrant}
        />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          data-testid="questionnaire-skip"
          className="gap-2"
          onClick={handleSkip}
        >
          <ChevronsRight className="icon-toolbar" aria-hidden="true" />
          {t('onboarding.questionnaire.skip')}
        </Button>
        <Button
          type="button"
          data-testid="questionnaire-continue"
          data-state={complete ? 'ready' : 'incomplete'}
          className={cn('gap-2', complete ? 'opacity-100' : 'opacity-60')}
          disabled={!complete}
          onClick={handleContinue}
        >
          <CornerDownLeft className="icon-toolbar" aria-hidden="true" />
          {t('onboarding.questionnaire.continue')}
        </Button>
      </div>

      {burst ? (
        <CoinsBurst
          count={burst.count}
          reason={burst.reason}
          confirmed
          onDismiss={() => setBurst(null)}
        />
      ) : null}
    </div>
  )
}

