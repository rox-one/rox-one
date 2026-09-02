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
import { LocalProfileStep, type LocalProfileSubmitData } from "./LocalProfileStep"
import type { ApiKeySubmitData, CustomEndpointModelInput } from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

export type { LocalProfileSubmitData } from "./LocalProfileStep"

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
