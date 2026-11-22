---
type: C4 Component
title: UseOnboarding
status: stable
groma:
  id: useonboarding
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useOnboarding.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useTurnCardExpansion.ts
      symbol: useTurnCardExpansion
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useWorkspaceIcon.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useInboxItems.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useViews.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/usePanelResize.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useWorkspaceTaskCount.ts
      symbol: useWorkspaceTaskCount
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useChatFolders.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useBackgroundTasks.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSiyuanConnected.ts
      symbol: useSiyuanConnected
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useWorkspaceGitModel.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useDirectoryPicker.ts
      symbol: useDirectoryPicker
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useRoxCloudAccount.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSessionSearch.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useMultiSelect.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useContainerWidth.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useInView.ts
      symbol: useInView
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useResizeGradient.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useEntityListInteractions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/onboarding-visible-error.ts
      symbol: visibleError
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSessionPresence.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useConfirmedTaskConversion.ts
      symbol: useConfirmedTaskConversion
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useEdgeRevealPanel.ts
      symbol: useEdgeRevealPanel
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useKanbanColumnColors.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useMessageReactionActor.ts
      symbol: useAuthenticatedReactionActor
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useRuntimeTrace.ts
      symbol: useRuntimeTrace
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useLabels.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSessionModelCatalog.ts
      symbol: useSessionModelCatalog
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useTransportConnectionState.ts
      symbol: useTransportConnectionState
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useResizablePanels.ts
      symbol: useResizablePanels
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useEntitySelection.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useAutomations.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useOpenClawAudit.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useProjectColorTreatment.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useInboxActorContext.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSessionOptions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useDynamicStack.ts
      symbol: useDynamicStack
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/usePanelWorkspaceLayout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSessionActions.ts
      symbol: useSessionActions
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useTheme.ts
      symbol: useTheme
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/use-skills-query.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSessionMenuActions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useNativeSurfaceBounds.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSession.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/oauth-cancel.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSuperEngineeringProfile.ts
      symbol: useSuperEngineeringProfile
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useToolchainStatus.ts
      symbol: useToolchainStatus
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useDocumentResizingFlag.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useProjects.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useUpdateChecker.ts
      symbol: useUpdateChecker
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useContextualSuggestions.ts
      symbol: useContextualSuggestions
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useCommandGateway.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useHorizontalResizeGradient.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSideSession.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useWindowCloseHandler.ts
      symbol: useWindowCloseHandler
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSeEditorZoom.ts
      symbol: useSeEditorZoom
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useStaleSessionRecovery.ts
      symbol: useStaleSessionRecovery
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useScrollEdgeAttribute.ts
      symbol: useScrollEdgeAttribute
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useHeaderStatusDeadline.ts
      symbol: useHeaderStatusDeadline
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useTerminalDockShortcut.ts
      symbol: useTerminalDockShortcut
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/usePages.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useLinkInterceptor.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/usePromoInsights.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useStatuses.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useSshConnectionStatus.ts
      symbol: useSshConnectionStatus
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useShellAppearance.ts
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useNotifications.ts
      symbol: useNotifications
    - scanner: typescript
      file: apps/electron/src/renderer/hooks/useQuestionMarkHelp.ts
description: Drives the onboarding wizard state machine from welcome through questionnaire, connection and finish.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/hooks/useConfirmedTaskConversion.ts](../../../../../../apps/electron/src/renderer/hooks/useConfirmedTaskConversion.ts) | [apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx](../../../../../../apps/electron/src/renderer/pages/meetings/LocalMeetingDetail.tsx) | Invokes supplied callback: onConfirmed | typescript |
