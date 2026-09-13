import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import * as storage from "@/lib/local-storage"
import { ONBOARDING_USERNAME_MAX, parseOnboardingUsername } from "./onboarding-username"
import { createStorageAdapter, rememberLocalProfile } from "./first-result-ui"
import { StepFormLayout, ContinueButton } from "./primitives"

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
  /** Whether the app is loading (e.g., checking Git Bash on Windows) */
  isLoading?: boolean
}

function persistOnboardingUsername(username: string): Promise<void> {
  const api = typeof window !== "undefined" ? window.electronAPI : undefined
  if (!api?.updateOrgIdentity || !api.identityUpdateProfile) {
    return Promise.reject(new Error('identity-unavailable'))
  }
  return Promise.all([
    api.updateOrgIdentity({ username, name: username }),
    api.identityUpdateProfile({ displayName: username }),
  ]).then(() => undefined)
}

/**
 * WelcomeStep - Initial welcome screen for onboarding
 *
 * First-run collects a username (in-app DisplayName). Workspace name stays
 * the OS user/computer name. Existing-user settings edits skip the gate.
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false
}: WelcomeStepProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isExistingUser) return
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (!api?.getOrgIdentity) return
    void api
      .getOrgIdentity()
      .then((identity) => {
        const existing = identity.username?.trim()
        if (existing) setUsername(existing)
      })
      .catch(() => {
        // Local identity read is optional; the username field still gates continue.
      })
  }, [isExistingUser])

  const handleContinue = async () => {
    if (isExistingUser) {
      onContinue()
      return
    }
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
    if (!parsed || saving) return
    setSaving(true)
    setError(null)
    try {
      await persistOnboardingUsername(parsed)
      storage.set(storage.KEYS.onboardingUsernameConfirmed, true)
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
      setSaving(false)
    }
  }

  const continueDisabled = isExistingUser
    ? isLoading
    : isLoading || saving || !parseOnboardingUsername(username)

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
          loading={isLoading || saving}
          loadingText={t("common.checking")}
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
        </div>
      )}
    </StepFormLayout>
  )
}
