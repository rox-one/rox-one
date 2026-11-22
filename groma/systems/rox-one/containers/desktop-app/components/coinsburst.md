---
type: C4 Component
title: CoinsBurst
status: stable
groma:
  id: coinsburst
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/CoinsBurst.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/CoinsBurst.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/PermissionsColumn.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/PermissionsColumn.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/ProfileQuestionnaireColumn.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/ProfileQuestionnaireColumn.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/BrowserImportPreferences.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/BrowserImportPreferences.tsx
      symbol: BrowserImportPreferences
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/brand-icons.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/brand-icons.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/RoleStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/RoleStep.tsx
      symbol: RoleStep
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/APISetupStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/APISetupStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/QuestionnaireStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/QuestionnaireStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/RoxCliCredentialStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/RoxCliCredentialStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/PillsStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/PillsStep.tsx
      symbol: PillsStep
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/WelcomeBrowserImportPreferences.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/WelcomeBrowserImportPreferences.tsx
      symbol: WelcomeBrowserImportPreferences
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx
      symbol: WelcomeStep
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/InterestBubbles.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/InterestBubbles.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/GitBashWarning.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/GitBashWarning.tsx
      symbol: GitBashWarning
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/InterestAccordion.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/InterestAccordion.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/primitives.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/primitives.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/start-visuals.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/start-visuals.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/RoxConnectStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/RoxConnectStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/BrowserIntelOptIn.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/BrowserIntelOptIn.tsx
      symbol: BrowserIntelOptIn
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/OnboardingError.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/OnboardingError.tsx
      symbol: OnboardingError
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/LayoutStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/LayoutStep.tsx
      symbol: LayoutStep
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/BrowserIntelProgress.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/BrowserIntelProgress.tsx
      symbol: BrowserIntelProgress
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/LocalProfileStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/LocalProfileStep.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/EnvironmentFields.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/EnvironmentFields.tsx
      symbol: EnvironmentFields
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/CompletionStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/CompletionStep.tsx
      symbol: CompletionStep
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/OnboardingStepProgress.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/OnboardingStepProgress.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/LocalModelStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/LocalModelStep.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/index.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/learning-curve.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/first-result-ui.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/bubbles-catalog.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/onboarding-username.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/onboarding-role.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/permissions-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/onboarding-rewards.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/identity-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/profile-questionnaire-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/rox-runtime-default.ts
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/SuperEngineeringOnboarding.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/SuperEngineeringOnboarding.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/onboarding/SuperEngineeringOnboardingDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/SuperEngineeringOnboardingDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/first-session-welcome.ts
      symbol: openFirstSessionWelcome
    - scanner: typescript
      file: apps/electron/src/renderer/components/onboarding/se-onboarding-gate.ts
description: Plays the confirmed Rox coins reward animation, degrading to a static notice under reduced motion.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx](../../../../../../apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx) | [apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx](../../../../../../apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx) | Invokes supplied callback: onStartOAuth | react |
| [apps/electron/src/renderer/components/onboarding/EnvironmentFields.tsx](../../../../../../apps/electron/src/renderer/components/onboarding/EnvironmentFields.tsx) | [apps/electron/src/renderer/pages/settings/EnvironmentSettingsSection.tsx](../../../../../../apps/electron/src/renderer/pages/settings/EnvironmentSettingsSection.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/onboarding/LocalModelStep.tsx](../../../../../../apps/electron/src/renderer/components/onboarding/LocalModelStep.tsx) | [apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx](../../../../../../apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx](../../../../../../apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx) | [apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx) | Invokes supplied callback: onFinish | react |
| [apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx](../../../../../../apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx) | [apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx](../../../../../../apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx](../../../../../../apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx) | [apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx](../../../../../../apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx) | Invokes supplied callback: onContinue | react |
| [apps/electron/src/renderer/components/onboarding/first-session-welcome.ts](../../../../../../apps/electron/src/renderer/components/onboarding/first-session-welcome.ts) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: ensureWelcome, getWindowWorkspace, isCurrent, onOpen, onSession | typescript |
