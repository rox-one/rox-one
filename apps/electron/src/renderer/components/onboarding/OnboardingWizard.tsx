import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { WelcomeStep } from "./WelcomeStep"
import { QuestionnaireStep, type QuestionnaireStepPayload } from "./QuestionnaireStep"
import {
  saveFirstRunDraft,
  type OnboardingDraftStorage,
} from "./identity-model"
import type { RewardLedger } from "./onboarding-rewards"
import { OnboardingStepProgress, type OnboardingProgressStep } from './OnboardingStepProgress'
import type { ApiSetupMethod } from "./APISetupStep"
import { ProviderSelectStep, type ProviderChoice } from "./ProviderSelectStep"
import { CredentialsStep, type CredentialStatus } from "./CredentialsStep"
import { LocalModelStep, type LocalModelSubmitData } from "./LocalModelStep"
import { RoxConnectStep, type RoxConnectCodes } from "./RoxConnectStep"
import { GitBashWarning, type GitBashStatus } from "./GitBashWarning"
import { RoxCliCredentialStep, type RoxCliCredentialSubmitData } from "./RoxCliCredentialStep"
import type { ApiKeySubmitData, CustomEndpointModelInput } from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

export type OnboardingStep =
  | 'welcome'
  | 'questionnaire'
  | 'rox-connect'
  | 'git-bash'
  | 'provider-select'
  | 'local-model'
  | 'credentials'
  | 'rox-cli-credential'
  /** Terminal state: the wizard closes (onFinish) — no completion screen. */
  | 'complete'

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

/**
 * First-run controller owned by `useOnboarding` and handed to the wizard through
 * `state`. Carries the shared reward ledger so the questionnaire screen writes
 * into one place; tests that build `OnboardingState` by hand simply omit it and
 * the steps fall back to their internal state.
 */
export interface OnboardingFirstRunState {
  rewards: RewardLedger
}

export interface OnboardingState {
  step: OnboardingStep
  loginStatus: LoginStatus
  credentialStatus: CredentialStatus
  completionStatus: 'saving' | 'complete'
  apiSetupMethod: ApiSetupMethod | null
  isExistingUser: boolean
  errorMessage?: string
  gitBashStatus?: GitBashStatus
  isRecheckingGitBash?: boolean
  isCheckingGitBash?: boolean
  /** First run: applying the default Rox runtime before the app opens. */
  isFinishing?: boolean
  /** Shared reward ledger (optional; the wizard self-manages otherwise). */
  firstRun?: OnboardingFirstRunState
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onContinue: () => void
  onBack: () => void
  onSelectApiSetupMethod: (method: ApiSetupMethod) => void
  onSubmitCredential: (data: ApiKeySubmitData) => void
  onSubmitOmpCredential?: (data: RoxCliCredentialSubmitData) => void
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

  // Provider select (Settings → ИИ)
  onSelectProvider?: (choice: ProviderChoice) => void

  // Rox cloud Connect
  roxConnectCodes?: RoxConnectCodes | null
  roxConnectStatus?: 'idle' | 'starting' | 'waiting' | 'success' | 'error'
  roxConnectError?: string
  roxAuthBaseUrl?: string
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
 * OnboardingWizard - Full-screen onboarding / provider setup container
 *
 * First run: Welcome (username) only, then the app opens with the Rox runtime.
 * Settings → ИИ: Provider Select (Rox / Claude / ChatGPT / Copilot / API Key /
 * Local) → Credentials or Local Model → closes when the connection is saved.
 * Reaching 'complete' calls onFinish once; there is no completion screen.
 */
export function OnboardingWizard({
  state,
  onContinue,
  onBack,
  onSelectApiSetupMethod,
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
  // Provider select (Settings → ИИ)
  onSelectProvider,
  roxConnectCodes,
  roxConnectStatus = 'idle',
  roxConnectError,
  roxAuthBaseUrl = 'https://rox.one',
  onStartRoxConnect,
  onOpenRoxConnectBrowser,
  // Local model
  onSubmitLocalModel,
  // Edit mode
  editInitialValues,
  className
}: OnboardingWizardProps) {
  const firstRun = state.firstRun
  // 'complete' is terminal: close the wizard exactly once per arrival.
  const finishedRef = useRef(false)
  useEffect(() => {
    if (state.step !== 'complete') {
      finishedRef.current = false
      return
    }
    if (finishedRef.current) return
    finishedRef.current = true
    onFinish()
  }, [state.step, onFinish])

  const firstRunStorage: OnboardingDraftStorage | undefined =
    typeof localStorage !== 'undefined' ? localStorage : undefined

  const persistQuestionnaireDraft = (payload: QuestionnaireStepPayload) => {
    saveFirstRunDraft(firstRunStorage, {
      questionnaire: payload.questionnaire,
      bubbles: payload.bubbles,
      permissions: payload.permissions,
      completed: true,
    })
    // The keep-awake mode is the one app-toggle with a real setting behind it:
    // mirror the choice onto the app config, fire-and-forget so a missing or
    // failing bridge never blocks the flow.
    const keepAwake = payload.permissions.enabled.keepAwake
    const bridge = window.electronAPI
    if (typeof keepAwake === 'boolean' && typeof bridge?.setKeepAwakeWhileRunning === 'function') {
      bridge.setKeepAwakeWhileRunning(keepAwake).catch(() => {})
    }
  }

  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
            isLoading={state.isCheckingGitBash}
            isFinishing={state.isFinishing}
          />
        )

      case 'questionnaire':
        return (
          <QuestionnaireStep
            onContinue={(payload) => {
              persistQuestionnaireDraft(payload)
              onContinue()
            }}
            onSkip={(payload) => {
              persistQuestionnaireDraft(payload)
              onContinue()
            }}
            {...(firstRun ? { rewards: firstRun.rewards } : {})}
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
            authBaseUrl={roxAuthBaseUrl}
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
            editInitialValues={editInitialValues}
            onCancelOAuth={onCancelOAuth}
            copilotDeviceCode={copilotDeviceCode}
            onClearError={onClearError}
          />
        )

      case 'rox-cli-credential':
        return (
          <RoxCliCredentialStep
            onSubmit={onSubmitOmpCredential ?? (() => {})}
            onBack={onBack}
            status={state.credentialStatus === 'validating' ? 'validating' : state.credentialStatus === 'error' ? 'error' : 'idle'}
            errorMessage={state.errorMessage}
            typedCode="OMP_NO_MODELS"
          />
        )

      case 'complete':
        // Closing via onFinish (effect above); keep the frame empty meanwhile.
        return null

      default:
        return null
    }
  }

  const progressStep: OnboardingProgressStep =
    state.step === 'welcome' ? 'profile' : state.step === 'complete' ? 'done' : 'connect'
  const isWelcome = state.step === 'welcome'

  return (
    <div
      className={cn(
        "bg-foreground-2 overflow-y-auto",
        !className?.includes('h-full') && "h-dvh",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-chrome" />

      {/* Main content — min-h-full + flex center means: center when content fits,
          natural flow + scroll when content is taller than the viewport (mobile). */}
      <main className="flex min-h-full items-center justify-center p-4 sm:p-8">
        {isWelcome ? (
          <div className="mx-auto max-w-lg px-6 py-8">
            <OnboardingStepProgress step={progressStep} className="mb-6" />
            <StepTransition key={state.step}>{renderStep()}</StepTransition>
          </div>
        ) : (
          <div className="flex w-full max-w-[28rem] flex-col items-center">
            <OnboardingStepProgress step={progressStep} className="mb-6 w-full" />
            <StepTransition key={state.step} className="w-full">
              {renderStep()}
            </StepTransition>
          </div>
        )}
      </main>
    </div>
  )
}

/**
 * StepTransition - the single step cross-fade (P-10-20).
 *
 * 180 ms opacity-only fade keyed by the wizard step (`--motion-base` /
 * `--ease-standard`); resolves to 0 ms under `prefers-reduced-motion: reduce`.
 * No transform, no blur.
 */
function StepTransition({ children, className }: { children: React.ReactNode; className?: string }) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      className={cn('transition-opacity', className)}
      style={{
        opacity: entered ? 1 : 0,
        transitionDuration: 'var(--motion-base)',
        transitionTimingFunction: 'var(--ease-standard)',
      }}
    >
      {children}
    </div>
  )
}
