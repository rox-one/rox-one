import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CornerDownLeft, Sparkles, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { trackLearningEvent } from './learning-curve'
import {
  DEFAULT_PROFILE_FORM,
  isProfileComplete,
  loadProfileDraft,
  saveProfileDraft,
  type ProfileDraftStorage,
  type ProfileFormValue,
} from './profile-form'
import { ProfileBubbles } from './ProfileBubbles'
import { LanguageSelect, ProfileTextField, TimezoneField } from './ProfileFields'
import {
  buildSuggestInput,
  normalizeSuggestResult,
  suggestErrorMessageKey,
  type ProfileSuggestState,
  type SuggestPreferencesInput,
} from './profile-suggest'
import { PROFILE_BUBBLE_GROUPS, PROFILE_BUBBLE_GROUP_ORDER } from './profile-catalog'
// Right column is owned by a parallel task; the import stays even if the file
// has not landed yet (integration adds it).
import { ProfilePermissionsColumn } from './profile-permissions/ProfilePermissionsColumn'
import { defaultPermissionValues, type PermissionValues } from './profile-permissions/permission-model'

/** Globally-unique chip ids for the two groups that drive adaptive ranking. */
const FUNCTION_BUBBLE_IDS = new Set(PROFILE_BUBBLE_GROUPS.function.items.map((item) => item.id))
const AREA_BUBBLE_IDS = new Set(PROFILE_BUBBLE_GROUPS.area.items.map((item) => item.id))

export interface ProfileStepProps {
  /** Persist the draft and advance to the next onboarding step. */
  onContinue: () => void
  /** «Заполнить позже»: persist the draft and advance without granting new consents. */
  onSkip: () => void
  /**
   * Suggestion transport; defaults to `window.electronAPI.suggestPreferences`.
   * Injected in tests. Absence is treated as `no-provider`.
   */
  suggestPreferences?: (input: SuggestPreferencesInput) => Promise<unknown>
  /** Local draft storage; defaults to `window.localStorage`. */
  storage?: ProfileDraftStorage
  /** Pre-seeded value (skips the local draft read). */
  initialValue?: ProfileFormValue
  className?: string
}

function defaultStorage(): ProfileDraftStorage | undefined {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : undefined
}

function defaultTransport(): ((input: SuggestPreferencesInput) => Promise<unknown>) | undefined {
  if (typeof window === 'undefined') return undefined
  const api = window.electronAPI
  if (!api || typeof api.suggestPreferences !== 'function') return undefined
  return api.suggestPreferences.bind(api)
}

/**
 * Onboarding «profile» step — a two-column questionnaire.
 *
 * Left: identity + language + city/timezone + free-form preferences and the
 * adaptive bubble cloud. Right: `ProfilePermissionsColumn`. Bottom:
 * «Продолжить» (gated on the required left fields) and «Заполнить позже».
 */
export function ProfileStep({
  onContinue,
  onSkip,
  suggestPreferences,
  storage,
  initialValue,
  className,
}: ProfileStepProps) {
  const { t } = useTranslation()
  const store = useMemo(() => storage ?? defaultStorage(), [storage])
  const [value, setValue] = useState<ProfileFormValue>(
    () => initialValue ?? loadProfileDraft(store) ?? { ...DEFAULT_PROFILE_FORM },
  )
  const [permissions, setPermissions] = useState<PermissionValues>(() => defaultPermissionValues())
  const [suggest, setSuggest] = useState<ProfileSuggestState>({ phase: 'idle' })
  const [pendingReplace, setPendingReplace] = useState<string | null>(null)
  const tracked = useRef(false)

  // Single analytics hook for this step (existing learning-curve buffer).
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    trackLearningEvent({ name: 'saw', stepId: 'profile', source: 'human' })
  }, [])

  // Local draft persistence on every edit.
  useEffect(() => {
    saveProfileDraft(store, value)
  }, [store, value])

  const update = useCallback((patch: Partial<ProfileFormValue>) => {
    setValue((current) => ({ ...current, ...patch }))
  }, [])

  const canContinue = isProfileComplete(value)
  const suggestLoading = suggest.phase === 'loading'
  const suggestError = suggest.phase === 'error' ? suggest : null

  const handleSuggest = useCallback(async () => {
    setPendingReplace(null)
    setSuggest({ phase: 'loading' })
    const transport = suggestPreferences ?? defaultTransport()
    if (!transport) {
      setSuggest({ phase: 'error', reason: 'no-provider' })
      return
    }
    try {
      const result = normalizeSuggestResult(await transport(buildSuggestInput(value)))
      if (!result.ok) {
        setSuggest({ phase: 'error', reason: result.reason })
        return
      }
      setSuggest({ phase: 'idle' })
      // Fill the textarea only when empty; otherwise ask before overwriting.
      if (value.preferences.trim().length === 0) update({ preferences: result.text })
      else setPendingReplace(result.text)
    } catch {
      setSuggest({ phase: 'error', reason: 'error' })
    }
  }, [suggestPreferences, value, update])

  const selectedBubbles = value.bubbles
  const functions = selectedBubbles.filter((id) => FUNCTION_BUBBLE_IDS.has(id))
  const areas = selectedBubbles.filter((id) => AREA_BUBBLE_IDS.has(id))

  return (
    <div className={cn('mx-auto w-full max-w-3xl px-6 py-8', className)} data-testid="onboarding-profile-step">
      <header className="text-center">
        <h1 className="text-lg font-semibold tracking-tight">{t('onboarding.profile.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('onboarding.profile.description')}</p>
      </header>

      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {/* Left column — questionnaire */}
        <div className="space-y-6">
          <ProfileTextField
            id="profile-name"
            label={t('onboarding.profile.fullName')}
            value={value.name}
            onChange={(name) => update({ name })}
            required
          />
          <ProfileTextField
            id="profile-birth-date"
            label={t('onboarding.profile.birthDate')}
            type="date"
            value={value.birthDate}
            onChange={(birthDate) => update({ birthDate })}
          />
          <LanguageSelect
            id="profile-interface-language"
            label={t('onboarding.profile.uiLanguage')}
            value={value.interfaceLanguage}
            onChange={(interfaceLanguage) => update({ interfaceLanguage })}
          />
          <LanguageSelect
            id="profile-communication-language"
            label={t('onboarding.profile.chatLanguage')}
            value={value.communicationLanguage}
            onChange={(communicationLanguage) => update({ communicationLanguage })}
          />
          <ProfileTextField
            id="profile-city"
            label={t('onboarding.profile.city')}
            value={value.city}
            onChange={(city) => update({ city })}
            placeholder={t('onboarding.profile.cityPlaceholder')}
          />
          <TimezoneField
            id="profile-timezone"
            label={t('onboarding.profile.timeZone')}
            value={value.timezone}
            onChange={(timezone) => update({ timezone })}
          />

          <div className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Label htmlFor="profile-preferences">{t('onboarding.profile.preferences')}</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="profile-suggest"
                disabled={suggestLoading}
                onClick={() => void handleSuggest()}
                className="group relative overflow-hidden rounded-full border-transparent bg-gradient-to-r from-status-danger/40 via-status-warning/40 to-accent/40 bg-[length:200%_100%] bg-left text-foreground shadow-minimal transition-[background-position] duration-500 hover:bg-right"
              >
                <Sparkles className="icon-toolbar" aria-hidden="true" />
                {suggestLoading ? t('onboarding.profile.suggesting') : t('onboarding.profile.suggest')}
              </Button>
            </div>
            <Textarea
              id="profile-preferences"
              value={value.preferences}
              rows={5}
              placeholder={t('onboarding.profile.preferencesPlaceholder')}
              onChange={(event) => update({ preferences: event.target.value })}
            />
            {suggestError ? (
              <p className="text-xs text-destructive" role="alert" data-testid="profile-suggest-error">
                {t(suggestErrorMessageKey(suggestError.reason))}
              </p>
            ) : null}
            {pendingReplace !== null ? (
              <div className="flex items-center gap-2 text-xs" data-testid="profile-suggest-confirm">
                <span className="text-muted-foreground">{t('onboarding.profile.suggestReplaceConfirm')}</span>
                <Button
                  type="button"
                  size="sm"
                  data-testid="profile-suggest-replace"
                  onClick={() => {
                    update({ preferences: pendingReplace })
                    setPendingReplace(null)
                  }}
                >
                  {t('onboarding.profile.suggestReplace')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setPendingReplace(null)}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            {PROFILE_BUBBLE_GROUP_ORDER.map((groupId) => (
              <ProfileBubbles
                key={groupId}
                groupId={groupId}
                selected={selectedBubbles}
                functions={functions}
                areas={areas}
                onChange={(next) => update({ bubbles: next })}
              />
            ))}
          </div>
        </div>

        {/* Right column — permissions (parallel task component) */}
        <ProfilePermissionsColumn value={permissions} onChange={setPermissions} />
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          data-testid="profile-skip"
          onClick={onSkip}
        >
          <ChevronsRight className="icon-toolbar" aria-hidden="true" />
          {t('onboarding.profile.skip')}
        </Button>
        <Button
          type="button"
          data-testid="profile-continue"
          disabled={!canContinue}
          onClick={onContinue}
        >
          <CornerDownLeft className="icon-toolbar" aria-hidden="true" />
          {t('onboarding.profile.continue')}
        </Button>
      </div>
    </div>
  )
}