import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ONBOARDING_USERNAME_MAX, parseOnboardingUsername, persistOnboardingUsername } from "./onboarding-username"
import { createStorageAdapter, rememberLocalProfile } from "./first-result-ui"
import { StepFormLayout, ContinueButton } from "./primitives"
import { WelcomeBrowserImportPreferences } from './WelcomeBrowserImportPreferences'

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
  /** Whether the app is loading (e.g., checking Git Bash on Windows) */
  isLoading?: boolean
  /** First run: the default Rox runtime is being applied before the app opens */
  isFinishing?: boolean
}

/**
 * WelcomeStep - the only onboarding screen
 *
 * First-run collects a username (in-app DisplayName) and offers browser import
 * preferences. Profile access is requested later from Import settings.
 * «Начать» opens the app with Rox; workspace name stays the OS user/computer
 * name. Existing-user settings edits skip the gate.
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false,
  isFinishing = false,
}: WelcomeStepProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState("")
  const [saving, setSaving] = useState(false)
  const [preferenceSaving, setPreferenceSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submitInFlight = useRef(false)

  useEffect(() => {
    let cancelled = false
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api) return
    void api.getOrgIdentity()
      .then(async orgIdentity => {
        // Native callers have their own profile; host-local account data is
        // read only for a confirmed legacy local identity.
        const identity = orgIdentity.authority === 'local'
          ? await api.identityGetState().catch(() => null)
          : null
        const existing = orgIdentity.name?.trim() || identity?.profile.displayName?.trim() || orgIdentity.username?.trim()
        if (existing && !cancelled) setUsername((current) => current || existing)
      })
      .catch(() => {
        // Identity reads are optional; a non-empty name is still required to continue.
      })
    return () => { cancelled = true }
  }, [isExistingUser])

  const handleContinue = async () => {
    if (isExistingUser) {
      onContinue()
      return
    }
    if (submitInFlight.current || saving || preferenceSaving || isFinishing) return
    const trimmed = username.trim()
    if (trimmed.length === 0) {
      setError(t("onboarding.welcome.usernameRequired"))
      return
    }
    if (trimmed.length > ONBOARDING_USERNAME_MAX) {
      setError(t("onboarding.welcome.usernameTooLong"))
      return
    }
    const parsed = parseOnboardingUsername(username)
    if (!parsed) return
    submitInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const api = typeof window !== "undefined" ? window.electronAPI : undefined
      if (!api) throw new Error('identity-unavailable')
      await persistOnboardingUsername(api, parsed)
      try {
        if (typeof localStorage !== "undefined") {
          rememberLocalProfile(createStorageAdapter(localStorage), parsed)
        }
      } catch {
        // Local first-result profile is optional; username still continues.
      }
      onContinue()
    } catch {
      setError(t("onboarding.welcome.usernameSaveFailed"))
    } finally {
      submitInFlight.current = false
      setSaving(false)
    }
  }

  const continueDisabled = isExistingUser
    ? isLoading || isFinishing
    : isLoading || isFinishing || saving || preferenceSaving || !parseOnboardingUsername(username)

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={isExistingUser ? t("onboarding.welcome.updateTitle") : t("onboarding.welcome.title")}
      description={
        isExistingUser
          ? t("onboarding.welcome.updateDescription")
          : t("onboarding.welcome.description")
      }
      actions={
        <ContinueButton
          onClick={() => void handleContinue()}
          className="w-full"
          disabled={continueDisabled}
          loading={isLoading || saving || preferenceSaving || isFinishing}
          loadingText={isFinishing ? t("onboarding.completion.settingUp") : preferenceSaving ? t('common.saving') : t("common.checking")}
        >
          {isExistingUser ? t("onboarding.welcome.continue") : t("onboarding.welcome.getStarted")}
        </ContinueButton>
      }
    >
      {!isExistingUser && (
        <div className="space-y-2 text-left">
          <Label htmlFor="onboarding-username">{t("onboarding.welcome.username")}</Label>
          <p className="text-sm text-muted-foreground">{t("onboarding.welcome.usernameHint")}</p>
          <Input
            id="onboarding-username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder={t("onboarding.welcome.usernamePlaceholder")}
            autoComplete="username"
            autoFocus
            maxLength={ONBOARDING_USERNAME_MAX}
            aria-required
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void handleContinue()
              }
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <WelcomeBrowserImportPreferences onSavingChange={setPreferenceSaving} />
        </div>
      )}
    </StepFormLayout>
  )
}
