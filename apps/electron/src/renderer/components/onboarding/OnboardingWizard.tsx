import { useEffect, useId, useMemo, useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, ShieldCheck, Sparkles, UserRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { WelcomeStep } from "./WelcomeStep"
import type { ApiSetupMethod } from "./APISetupStep"
import { ProviderSelectStep, type ProviderChoice } from "./ProviderSelectStep"
import { CredentialsStep, type CredentialStatus } from "./CredentialsStep"
import { LocalModelStep, type LocalModelSubmitData } from "./LocalModelStep"
import { CompletionStep } from "./CompletionStep"
import { RoxConnectStep, type RoxConnectCodes } from "./RoxConnectStep"
import { GitBashWarning, type GitBashStatus } from "./GitBashWarning"
import { OmpCredentialStep, type OmpCredentialSubmitData } from "./OmpCredentialStep"
import type { ApiKeySubmitData, CustomEndpointModelInput } from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

export interface LocalProfileSubmitData {
  displayName: string
}

function LocalProfileStep({
  initialDisplayName,
  status = 'idle',
  errorMessage,
  onSubmit,
  onConnectCloud,
}: {
  initialDisplayName?: string
  status?: 'idle' | 'waiting' | 'success' | 'error'
  errorMessage?: string
  onSubmit: (data: LocalProfileSubmitData) => void
  onConnectCloud?: () => void
}) {
  const { t } = useTranslation()
  const inputId = useId()
  const helpId = useId()
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "")
  const trimmedName = displayName.trim()
  const isBusy = status === 'waiting'

  useEffect(() => {
    if (initialDisplayName) setDisplayName(initialDisplayName)
  }, [initialDisplayName])

  const helperText = useMemo(() => {
    if (!trimmedName) return t("onboarding.localProfile.displayNameRequired")
    return t("onboarding.localProfile.displayNameHelper")
  }, [t, trimmedName])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!trimmedName || isBusy) return
    onSubmit({ displayName: trimmedName })
  }

  return (
    <div className="flex w-full max-w-[32rem] flex-col items-center">
      <div className="mb-6 shrink-0">
        <div className="relative flex size-16 items-center justify-center rounded-[20px] border border-accent/30 bg-accent/10 shadow-[0_0_34px_rgba(139,92,246,0.22)]">
          <Sparkles className="absolute -right-1 -top-1 size-4 text-accent" />
          <UserRound className="size-8 text-accent" />
        </div>
      </div>

      <div className="shrink-0 text-center">
        <h1 className="step-title text-lg font-semibold tracking-tight">
          {t("onboarding.localProfile.title")}
        </h1>
        <p className="step-description mt-2 max-w-sm text-sm text-muted-foreground">
          {t("onboarding.localProfile.description")}
        </p>
      </div>

      <div className="mt-6 w-full">
        <form id="local-profile-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{t("onboarding.localProfile.displayName")}</Label>
            <Input
              id={inputId}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={t("onboarding.localProfile.displayNamePlaceholder")}
              autoComplete="name"
              autoFocus
              disabled={isBusy}
              aria-describedby={helpId}
              aria-invalid={!trimmedName}
              className="h-11 rounded-xl border-foreground/15 bg-background/70 px-4 text-base shadow-minimal"
            />
            <p
              id={helpId}
              className={cn(
                "text-xs leading-relaxed",
                trimmedName ? "text-muted-foreground" : "text-warning",
              )}
            >
              {helperText}
            </p>
          </div>

          <div className="rounded-2xl border border-foreground/10 bg-foreground/[0.025] p-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success">
                <ShieldCheck className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("onboarding.localProfile.localBadge")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("onboarding.localProfile.trust")}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-accent/15 bg-accent/[0.045] p-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent">
                <ArrowRight className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {t("onboarding.localProfile.nextTitle")}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t("onboarding.localProfile.nextHint")}
                </p>
              </div>
            </div>
          </div>

          {errorMessage ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </form>
      </div>

      <div className="step-actions mt-6 flex w-full shrink-0 gap-3 justify-center">
        {onConnectCloud ? (
          <Button
            type="button"
            variant="outline"
            onClick={onConnectCloud}
            disabled={isBusy}
            className="h-11 flex-1 rounded-xl border-foreground/15 bg-background/60 px-4"
          >
            {t("onboarding.localProfile.cloudHint")}
          </Button>
        ) : null}
        <Button
          type="submit"
          form="local-profile-form"
          disabled={isBusy || !trimmedName}
          className="h-11 flex-1 rounded-xl bg-foreground px-4 text-background hover:bg-foreground/90"
        >
          {isBusy ? t("common.saving") : t("onboarding.localProfile.submit")}
        </Button>
      </div>
    </div>
  )
}

export type OnboardingStep =
  | 'local-profile'
  | 'welcome'
  | 'rox-connect'
  | 'git-bash'
  | 'provider-select'
  | 'local-model'
  | 'credentials'
  | 'omp-credential'
  | 'complete'

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

export interface OnboardingState {
  step: OnboardingStep
  loginStatus: LoginStatus
  credentialStatus: CredentialStatus
  completionStatus: 'saving' | 'complete'
  apiSetupMethod: ApiSetupMethod | null
  apiCredentialPreset?: string
  isExistingUser: boolean
  localProfileName?: string
  errorMessage?: string
  gitBashStatus?: GitBashStatus
  isRecheckingGitBash?: boolean
  isCheckingGitBash?: boolean
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onContinue: () => void
  onBack: () => void
  onSelectApiSetupMethod: (method: ApiSetupMethod) => void
  onSubmitLocalProfile?: (data: LocalProfileSubmitData) => void
  onSubmitCredential: (data: ApiKeySubmitData) => void
  onSubmitOmpCredential?: (data: OmpCredentialSubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onFinish: () => void

  // Claude OAuth (two-step flow)
  isWaitingForCode?: boolean
  isProviderOAuthPending?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void

  // Copilot device flow
  copilotDeviceCode?: { userCode: string; verificationUri: string }

  // Git Bash (Windows)
  onBrowseGitBash?: () => Promise<string | null>
  onUseGitBashPath?: (path: string) => void
  onRecheckGitBash?: () => void
  onClearError?: () => void

  // Provider select (new flow)
  onSelectProvider?: (choice: ProviderChoice) => void
  /** Called when user chooses "Setup later" on provider select */
  onSkipSetup?: () => void
  onConnectCloudFromProfile?: () => void

  // Rox cloud Connect
  roxConnectCodes?: RoxConnectCodes | null
  roxConnectStatus?: 'idle' | 'starting' | 'waiting' | 'success' | 'error'
  roxConnectError?: string
  onStartRoxConnect?: () => void
  onOpenRoxConnectBrowser?: () => void

  // Local model
  onSubmitLocalModel?: (data: LocalModelSubmitData) => void

  // Edit mode (pre-fill existing connection values)
  editInitialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: CustomEndpointModelInput[]
    customApi?: CustomEndpointApi
  }

  className?: string
}

/**
 * OnboardingWizard - Full-screen onboarding flow container
 *
 * Manages the step-by-step flow for setting up Rox:
 * 1. Rox cloud sign-in when required
 * 2. Windows prerequisites when required
 * 3. Provider Select (Rox / existing subscriptions / API Key / Local)
 * 4. Credentials (API Key or OAuth) or Local Model
 * 5. Completion
 */
export function OnboardingWizard({
  state,
  onContinue,
  onBack,
  onSelectApiSetupMethod,
  onSubmitLocalProfile,
  onSubmitCredential,
  onSubmitOmpCredential,
  onStartOAuth,
  onFinish,
  // Two-step OAuth flow
  isWaitingForCode,
  isProviderOAuthPending,
  onSubmitAuthCode,
  onCancelOAuth,
  // Copilot device flow
  copilotDeviceCode,
  // Git Bash (Windows)
  onBrowseGitBash,
  onUseGitBashPath,
  onRecheckGitBash,
  onClearError,
  // Provider select (new flow)
  onSelectProvider,
  onSkipSetup,
  onConnectCloudFromProfile,
  roxConnectCodes,
  roxConnectStatus = 'idle',
  roxConnectError,
  onStartRoxConnect,
  onOpenRoxConnectBrowser,
  // Local model
  onSubmitLocalModel,
  // Edit mode
  editInitialValues,
  className
}: OnboardingWizardProps) {
  const effectiveEditInitialValues = state.apiCredentialPreset
    ? { ...(editInitialValues ?? {}), activePreset: state.apiCredentialPreset }
    : editInitialValues

  const renderStep = () => {
    switch (state.step) {
      case 'local-profile':
        return (
          <LocalProfileStep
            initialDisplayName={state.localProfileName}
            status={state.loginStatus}
            errorMessage={state.errorMessage}
            onSubmit={onSubmitLocalProfile ?? (() => {})}
            onConnectCloud={onConnectCloudFromProfile}
          />
        )

      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
            isLoading={state.isCheckingGitBash}
          />
        )

      case 'rox-connect':
        return (
          <RoxConnectStep
            codes={roxConnectCodes ?? null}
            status={roxConnectStatus}
            errorMessage={roxConnectError}
            onStart={onStartRoxConnect!}
            onOpenBrowser={onOpenRoxConnectBrowser!}
          />
        )

      case 'git-bash':
        return (
          <GitBashWarning
            status={state.gitBashStatus!}
            onBrowse={onBrowseGitBash!}
            onUsePath={onUseGitBashPath!}
            onRecheck={onRecheckGitBash!}
            onBack={onBack}
            isRechecking={state.isRecheckingGitBash}
            errorMessage={state.errorMessage}
            onClearError={onClearError}
          />
        )

      case 'provider-select':
        return (
          <ProviderSelectStep
            onSelect={onSelectProvider!}
            onSkip={onSkipSetup}
          />
        )

      case 'local-model':
        return (
          <LocalModelStep
            onSubmit={onSubmitLocalModel!}
            onBack={onBack}
            status={state.credentialStatus === 'validating' ? 'validating' : state.credentialStatus === 'error' ? 'error' : 'idle'}
            errorMessage={state.errorMessage}
          />
        )

      case 'credentials':
        return (
          <CredentialsStep
            apiSetupMethod={state.apiSetupMethod!}
            status={state.credentialStatus}
            errorMessage={state.errorMessage}
            onSubmit={onSubmitCredential}
            onStartOAuth={onStartOAuth}
            onBack={onBack}
            isWaitingForCode={isWaitingForCode}
            isProviderOAuthPending={isProviderOAuthPending}
            onSubmitAuthCode={onSubmitAuthCode}
            editInitialValues={effectiveEditInitialValues}
            onCancelOAuth={onCancelOAuth}
            copilotDeviceCode={copilotDeviceCode}
          />
        )

      case 'omp-credential':
        return (
          <OmpCredentialStep
            onSubmit={onSubmitOmpCredential ?? (() => {})}
            onBack={onBack}
            status={state.credentialStatus === 'validating' ? 'validating' : state.credentialStatus === 'error' ? 'error' : 'idle'}
            errorMessage={state.errorMessage}
            typedCode="OMP_NO_MODELS"
          />
        )

      case 'complete':
        return (
          <CompletionStep
            status={state.completionStatus}
            onFinish={onFinish}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        "bg-foreground-2 overflow-y-auto",
        !className?.includes('h-full') && "h-dvh",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content — min-h-full + flex center means: center when content fits,
          natural flow + scroll when content is taller than the viewport (mobile). */}
      <main className="flex min-h-full items-center justify-center p-4 sm:p-8">
        {renderStep()}
      </main>
    </div>
  )
}
