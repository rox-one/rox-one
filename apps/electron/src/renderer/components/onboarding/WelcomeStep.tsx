import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAtomValue } from "jotai"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { windowWorkspaceIdAtom } from "@/atoms/sessions"
import { GithubLinkDialog } from "@/components/onboarding/github-link/GithubLinkDialog"
import {
  HANDLE_CHECK_DEBOUNCE_MS,
  ONBOARDING_ORGANIZATION_MAX,
  ONBOARDING_USERNAME_MAX,
  ROX_COIN_REWARDS,
  createHandleAvailabilityTracker,
  defaultOnboardingOrganization,
  identityCoinState,
  normalizeHandleInput,
  parseHandleAvailabilityResponse,
  parseOnboardingOrganization,
  parseOnboardingUsername,
  persistOnboardingUsername,
  reservedIdentityAddresses,
  resolveOnboardingOrganization,
  shouldShowReservedBlock,
  type HandleAvailability,
  type HandleCheckStatus,
} from "./onboarding-username"
import { createStorageAdapter, rememberLocalProfile } from "./first-result-ui"
import { StepFormLayout, ContinueButton } from "./primitives"
import { TelegramLinkDialog } from "./telegram-link/TelegramLinkDialog"
import { WelcomeBrowserImportPreferences } from './WelcomeBrowserImportPreferences'
import { BrowserIntelOptIn } from './BrowserIntelOptIn'
import { BrowserIntelProgress } from './BrowserIntelProgress'

interface WelcomeStepProps {
  onContinue: () => void
  /** Whether this is an existing user updating settings */
  isExistingUser?: boolean
  /** Whether the app is loading (e.g., checking Git Bash on Windows) */
  isLoading?: boolean
  /** First run: the default Rox runtime is being applied before the app opens */
  isFinishing?: boolean
}

/** Small round Rox coin mark — an "R", never a ruble sign. */
function RoxCoinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.16" />
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <text x="8" y="11.3" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor">R</text>
    </svg>
  )
}

/** Informational reward badge: grey until the action completes, then gold. */
function CoinBadge({ gold, label }: { gold: boolean; label: string }) {
  return (
    <span
      data-testid="rox-coin-badge"
      data-state={gold ? "gold" : "grey"}
      title={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption font-medium tabular-nums",
        gold ? "text-status-warning" : "text-muted-foreground/50",
      )}
    >
      <RoxCoinIcon className="size-3.5" />
      <span>{label}</span>
    </span>
  )
}

/**
 * WelcomeStep - the only onboarding screen
 *
 * First-run collects the public identity (username + organization), shows the
 * reserved rox.one addresses, links Telegram/GitHub, and offers browser import
 * preferences. Profile access is requested later from Import settings.
 * «Начать» opens the app with Rox.
 */
export function WelcomeStep({
  onContinue,
  isExistingUser = false,
  isLoading = false,
  isFinishing = false,
}: WelcomeStepProps) {
  const { t } = useTranslation()
  const activeWorkspaceId = useAtomValue(windowWorkspaceIdAtom)
  const [username, setUsername] = useState("")
  const [organization, setOrganization] = useState("")
  const [usernameStatus, setUsernameStatus] = useState<HandleCheckStatus>("idle")
  const [saving, setSaving] = useState(false)
  const [preferenceSaving, setPreferenceSaving] = useState(false)
  const [intelSaving, setIntelSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [telegramOpen, setTelegramOpen] = useState(false)
  const [telegramLinked, setTelegramLinked] = useState(false)
  const [githubOpen, setGithubOpen] = useState(false)
  const [githubLinked, setGithubLinked] = useState(false)
  const [githubWorkspaceId, setGithubWorkspaceId] = useState<string | null>(null)
  const submitInFlight = useRef(false)
  const tracker = useRef(createHandleAvailabilityTracker())

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

  // Debounced availability probe. Out-of-order responses and requests for a
  // value that has since changed are dropped by the tracker; a failed probe is
  // 'unknown', never green.
  useEffect(() => {
    const active = tracker.current
    const parsed = parseOnboardingUsername(username)
    if (!parsed) {
      active.invalidate()
      setUsernameStatus(normalizeHandleInput(username).length === 0 ? "idle" : "invalid")
      return
    }
    setUsernameStatus("checking")
    const token = active.begin(parsed)
    const timer = setTimeout(() => {
      const api = typeof window !== "undefined" ? window.electronAPI : undefined
      const settle = (result: HandleAvailability) => {
        const accepted = active.settle(token, result)
        if (accepted) setUsernameStatus(accepted)
      }
      if (typeof api?.checkOnboardingHandle !== "function") {
        settle("unknown")
        return
      }
      void api.checkOnboardingHandle(parsed.toLowerCase())
        .then(raw => settle(parseHandleAvailabilityResponse(raw)))
        .catch(() => settle("unknown"))
    }, HANDLE_CHECK_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [username])

  // Resolve a workspace for the GitHub device flow lazily, only when needed.
  useEffect(() => {
    if (!githubOpen || activeWorkspaceId || githubWorkspaceId) return
    const api = typeof window !== "undefined" ? window.electronAPI : undefined
    if (typeof api?.getWorkspaces !== "function") return
    let cancelled = false
    void api.getWorkspaces()
      .then(workspaces => {
        const id = workspaces?.[0]?.id
        if (!cancelled && id) setGithubWorkspaceId(id)
      })
      .catch(() => { /* No workspace → the dialog states the flow is unavailable. */ })
    return () => { cancelled = true }
  }, [githubOpen, activeWorkspaceId, githubWorkspaceId])

  const parsedUsername = parseOnboardingUsername(username)
  const parsedOrganization = parseOnboardingOrganization(organization)
  const organizationInput = normalizeHandleInput(organization)
  const effectiveOrganization = resolveOnboardingOrganization(username, organization)
  const organizationInvalid = organizationInput.length > 0 && parsedOrganization === null
  const organizationAccepted = effectiveOrganization !== null
  const coins = identityCoinState({
    usernameStatus,
    organizationAccepted,
    telegramLinked,
    githubLinked,
  })
  const showReserved = shouldShowReservedBlock(usernameStatus) && parsedUsername !== null && effectiveOrganization !== null
  const addresses = showReserved && parsedUsername && effectiveOrganization
    ? reservedIdentityAddresses(parsedUsername, effectiveOrganization)
    : null
  const organizationPlaceholder = parsedUsername
    ? defaultOnboardingOrganization(parsedUsername)
    : t("onboarding.welcome.organizationPlaceholder")

  const handleContinue = async () => {
    if (isExistingUser) {
      onContinue()
      return
    }
    if (submitInFlight.current || saving || preferenceSaving || intelSaving || isFinishing) return
    if (!parsedUsername) {
      setError(t("onboarding.welcome.usernameRequired"))
      return
    }
    if (usernameStatus === "taken" || usernameStatus === "reserved") {
      setError(t("onboarding.welcome.usernameTaken"))
      return
    }
    submitInFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const api = typeof window !== "undefined" ? window.electronAPI : undefined
      if (!api) throw new Error('identity-unavailable')
      await persistOnboardingUsername(api, parsedUsername, {
        publicHandle: parsedUsername,
        ...(effectiveOrganization ? { organization: effectiveOrganization } : {}),
      })
      try {
        if (typeof localStorage !== "undefined") {
          rememberLocalProfile(createStorageAdapter(localStorage), parsedUsername)
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

  const usernameBlocked = usernameStatus === "taken" || usernameStatus === "reserved"
  const continueBusy = isLoading || saving || preferenceSaving || intelSaving || isFinishing
  const continueDisabled = isExistingUser
    ? isLoading || isFinishing
    : isLoading || isFinishing || saving || preferenceSaving || intelSaving || !parsedUsername || usernameBlocked

  const usernameHint = (() => {
    switch (usernameStatus) {
      case "checking":
        return <p className="text-xs text-muted-foreground">{t("onboarding.welcome.usernameChecking")}</p>
      case "available":
        return <p className="text-xs text-success">{t("onboarding.welcome.usernameAvailable")}</p>
      case "taken":
        return <p className="text-xs text-destructive">{t("onboarding.welcome.usernameTaken")}</p>
      case "reserved":
        return <p className="text-xs text-destructive">{t("onboarding.welcome.usernameReserved")}</p>
      case "unknown":
        return <p className="text-xs text-muted-foreground">{t("onboarding.welcome.usernameUnknown")}</p>
      case "invalid":
        return <p className="text-xs text-destructive">{t("onboarding.welcome.usernameInvalid")}</p>
      default:
        return <p className="text-xs text-muted-foreground">{t("onboarding.welcome.usernameHint")}</p>
    }
  })()

  const githubWorkspace = activeWorkspaceId ?? githubWorkspaceId

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-14" />
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
          loading={continueBusy}
          aria-busy={continueBusy || undefined}
          loadingText={isFinishing ? t("onboarding.completion.settingUp") : (preferenceSaving || intelSaving) ? t('common.saving') : t("common.checking")}
        >
          {isExistingUser ? t("onboarding.welcome.continue") : t("onboarding.welcome.getStarted")}
        </ContinueButton>
      }
    >
      {!isExistingUser && (
        <div className="space-y-4 text-left">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="onboarding-username">{t("onboarding.welcome.username")}</Label>
              <CoinBadge gold={coins.username} label={t("onboarding.welcome.coins.reward", { count: ROX_COIN_REWARDS.username })} />
            </div>
            <Input
              id="onboarding-username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder={t("onboarding.welcome.usernamePlaceholder")}
              autoComplete="username"
              autoFocus
              maxLength={ONBOARDING_USERNAME_MAX}
              aria-required
              aria-invalid={usernameStatus === "invalid" || usernameStatus === "taken" || usernameStatus === "reserved"}
              className="h-10 rounded-full border-border-subtle bg-background/40 px-4 shadow-none focus-visible:border-border-strong focus-visible:ring-0"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  void handleContinue()
                }
              }}
            />
            {usernameHint}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="onboarding-organization">{t("onboarding.welcome.organization")}</Label>
              <CoinBadge gold={coins.organization} label={t("onboarding.welcome.coins.reward", { count: ROX_COIN_REWARDS.organization })} />
            </div>
            <Input
              id="onboarding-organization"
              value={organization}
              onChange={(event) => setOrganization(event.target.value)}
              placeholder={organizationPlaceholder}
              maxLength={ONBOARDING_ORGANIZATION_MAX}
              aria-invalid={organizationInvalid}
              className="h-10 rounded-full border-border-subtle bg-background/40 px-4 shadow-none focus-visible:border-border-strong focus-visible:ring-0"
            />
            {organizationInvalid && (
              <p className="text-xs text-destructive">{t("onboarding.welcome.organizationInvalid")}</p>
            )}
          </div>

          {addresses && (
            <div className="space-y-1 rounded-lg border border-status-success/30 bg-status-success/5 p-3 text-xs text-success">
              <p>{t("onboarding.welcome.reservedUsername")}{" "}<strong className="font-semibold">{addresses.handle}</strong></p>
              <p>{t("onboarding.welcome.reservedOrganization")}{" "}<strong className="font-semibold">{addresses.organization}</strong></p>
              <p>{t("onboarding.welcome.reservedEmail")}{" "}<strong className="font-semibold">{addresses.email}</strong></p>
              <p className="text-caption opacity-70">{t("onboarding.welcome.reservedEmailNote")}</p>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 gap-2 rounded-full"
              onClick={() => setTelegramOpen(true)}
            >
              {t("onboarding.welcome.linkTelegram")}
              <CoinBadge gold={coins.telegram} label={t("onboarding.welcome.coins.reward", { count: ROX_COIN_REWARDS.telegram })} />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1 gap-2 rounded-full"
              onClick={() => setGithubOpen(true)}
            >
              {t("onboarding.welcome.linkGithub")}
              <CoinBadge gold={coins.github} label={t("onboarding.welcome.coins.reward", { count: ROX_COIN_REWARDS.github })} />
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <WelcomeBrowserImportPreferences onSavingChange={setPreferenceSaving} />
          <BrowserIntelOptIn onSavingChange={setIntelSaving} className="mt-5" />
          <BrowserIntelProgress className="mt-4" />
        </div>
      )}

      <TelegramLinkDialog
        open={telegramOpen}
        onOpenChange={setTelegramOpen}
        onLinked={() => setTelegramLinked(true)}
      />

      <GithubLinkDialog
        open={githubOpen}
        onOpenChange={setGithubOpen}
        workspaceId={githubWorkspace ?? undefined}
        onLinked={() => { setGithubLinked(true); setGithubOpen(false) }}
      />
    </StepFormLayout>
  )
}