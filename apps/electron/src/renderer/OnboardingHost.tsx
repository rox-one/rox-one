/**
 * OC-13 / #1675: first-run wizard + useOnboarding live outside the ready shell.
 * App.tsx must not statically import this module — React.lazy keeps the ~2 MB
 * onboarding graph out of index.html's modulepreload closure.
 */
import { DismissibleLayerProvider } from '@/context/DismissibleLayerContext'
import { ModalProvider } from '@/context/ModalContext'
import { useWindowCloseHandler } from '@/hooks/useWindowCloseHandler'
import { useOnboarding } from '@/hooks/useOnboarding'
import { OnboardingWizard } from '@/components/onboarding'
import type { SetupNeeds } from '../shared/types'

function WindowCloseHandler() {
  useWindowCloseHandler()
  return null
}

export interface OnboardingHostProps {
  onComplete: () => void | boolean | Promise<void | boolean>
  onConfigSaved?: () => void | Promise<void>
  initialSetupNeeds?: SetupNeeds
  existingSlugs?: Set<string>
}

export default function OnboardingHost({
  onComplete,
  onConfigSaved,
  initialSetupNeeds,
  existingSlugs,
}: OnboardingHostProps) {
  const onboarding = useOnboarding({
    onComplete,
    onConfigSaved,
    initialSetupNeeds,
    existingSlugs,
    initialStep: 'welcome',
  })

  return (
    <DismissibleLayerProvider>
      <ModalProvider>
        <WindowCloseHandler />
        <OnboardingWizard
          state={onboarding.state}
          onContinue={onboarding.handleContinue}
          onContinueLocally={onboarding.handleContinueLocally}
          onBack={onboarding.handleBack}
          onSelectProvider={onboarding.handleSelectProvider}
          roxConnectCodes={onboarding.roxConnectCodes}
          roxConnectStatus={onboarding.roxConnectStatus}
          roxConnectError={onboarding.roxConnectError}
          roxAuthBaseUrl={onboarding.roxAuthBaseUrl}
          onStartRoxConnect={onboarding.handleStartRoxConnect}
          onOpenRoxConnectBrowser={onboarding.handleOpenRoxConnectBrowser}
          onSelectApiSetupMethod={onboarding.handleSelectApiSetupMethod}
          onSubmitCredential={onboarding.handleSubmitCredential}
          onSubmitOmpCredential={onboarding.handleSubmitOmpCredential}
          onSubmitLocalModel={onboarding.handleSubmitLocalModel}
          onStartOAuth={onboarding.handleStartOAuth}
          onFinish={onboarding.handleFinish}
          isWaitingForCode={onboarding.isWaitingForCode}
          isProviderOAuthPending={onboarding.isProviderOAuthPending}
          onSubmitAuthCode={onboarding.handleSubmitAuthCode}
          onCancelOAuth={onboarding.handleCancelOAuth}
          copilotDeviceCode={onboarding.copilotDeviceCode}
          onBrowseGitBash={onboarding.handleBrowseGitBash}
          onUseGitBashPath={onboarding.handleUseGitBashPath}
          onRecheckGitBash={onboarding.handleRecheckGitBash}
          onClearError={onboarding.handleClearError}
        />
      </ModalProvider>
    </DismissibleLayerProvider>
  )
}
