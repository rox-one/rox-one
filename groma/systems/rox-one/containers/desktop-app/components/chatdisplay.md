---
type: C4 Component
title: ChatDisplay
status: stable
groma:
  id: chatdisplay
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/BatchSessionMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/BatchSessionMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/CompactSessionMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/CompactSessionMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelHeader.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelHeader.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/QuestProgressCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/QuestProgressCard.tsx
      symbol: QuestProgressCard
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionStatusIcon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionStatusIcon.tsx
      symbol: SessionStatusIcon
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/UserProfilePopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/UserProfilePopover.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MemoryProvenanceStrip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MemoryProvenanceStrip.tsx
      symbol: MemoryProvenanceStrip
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SourceMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SourceMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SkillMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SkillMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/TaskActionMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/TaskActionMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MemoryProposalCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MemoryProposalCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MiniDashboardCards.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MiniDashboardCards.tsx
      symbol: MiniDashboardCards
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ProjectsHomeInMain.tsx
      symbol: ProjectsHomeInMain
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/CompactPanelTransition.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/CompactPanelTransition.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SendResourceToWorkspaceDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SendResourceToWorkspaceDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/NavigatorPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/NavigatorPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionProjectColorWrapper.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionProjectColorWrapper.tsx
      symbol: SessionProjectColorWrapper
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionTypingIndicator.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionTypingIndicator.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ShellLayoutMode.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ShellLayoutMode.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionItem.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionItem.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/EntityViewTabs.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/EntityViewTabs.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/TransportConnectionBanner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/TransportConnectionBanner.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionSuggestionsHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionSuggestionsHost.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelResizeSash.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelResizeSash.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionLanes.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionLanes.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionMenuParts.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionMenuParts.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ChatDisplay.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ChatDisplay.playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/WhatsNewTimeline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/WhatsNewTimeline.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionInfoPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionInfoPopover.tsx
      symbol: SessionInfoPopover
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionListSkeleton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionListSkeleton.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ShellSidebarPortal.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ShellSidebarPortal.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/LaneRule.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/LaneRule.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionBadges.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionBadges.tsx
      symbol: SessionBadges
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionOwnerChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionOwnerChip.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ActiveTasksBar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ActiveTasksBar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionList.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ProfileStrip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ProfileStrip.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/DeviceStatusChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/DeviceStatusChip.tsx
      symbol: DeviceStatusChip
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MemoryListPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MemoryListPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/BackgroundFinishedChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/BackgroundFinishedChip.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/AttachmentPreview.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/AttachmentPreview.tsx
      symbol: AttachmentPreview
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ProjectMultiSelectFilter.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ProjectMultiSelectFilter.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionSearchHeader.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionSearchHeader.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/InspectorInfoMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/InspectorInfoMenu.tsx
      symbol: InspectorInfoMenu
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/AccountMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/AccountMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionParticipantsPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionParticipantsPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/resize-controller.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/resize-math.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/panel-constants.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/useChatOutputFollow.ts
      symbol: useChatOutputFollow
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/entity-list-virtualization.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/sidebar-types.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/error-message-actions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/session-row-click.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/resize-activity.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/branching.ts
      symbol: resolveBranchNewPanelOption
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/route-pages.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/auxiliary-persistence.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/nav-placement.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/mode-pill-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/plan-approval-message.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/nav-destinations.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/profile-strip-account.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/background-task-chip-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/primary-nav.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-timeline-window.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/surface-navigation-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/sidebar-keyboard.ts
      symbol: handleSidebarTreeKeyDown
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/new-session-filter-inheritance.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/chat-scroll.ts
      symbol: followChatOutput
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/transfer-targets.ts
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ShellSidebarNav.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ShellSidebarNav.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/ToolchainStatusBanner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/ToolchainStatusBanner.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SetupAuthBanner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SetupAuthBanner.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/AuxiliaryToolPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/AuxiliaryToolPanel.tsx
      symbol: AuxiliaryToolPanel
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MiniSessionSurface.tsx
      symbol: MiniSessionSurface
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelSlot.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelSlot.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SuperEngineeringShellExtras.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SuperEngineeringShellExtras.tsx
      symbol: SuperEngineeringShellExtras
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/FabNewChat.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/FabNewChat.tsx
      symbol: FabNewChat
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/HeaderStatusLane.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/HeaderStatusLane.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelGridResizeSash.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelGridResizeSash.tsx
      symbol: PanelGridResizeSash
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelSeam.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelSeam.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/AppShell.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/AppShell.tsx
      symbol: AppShell
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SidebarNewSessionButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SidebarNewSessionButton.tsx
      symbol: SidebarNewSessionButton
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/TopBar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/TopBar.tsx
      symbol: TopBar
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelStackContainer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelStackContainer.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/WhatsNewSheet.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/WhatsNewSheet.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/Panel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/Panel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SidebarChrome.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SidebarChrome.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SidebarMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SidebarMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SeChatPictureInPicture.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SeChatPictureInPicture.tsx
      symbol: SeChatPictureInPicture
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/RecentPinnedSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/RecentPinnedSidebar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SendToWorkspaceDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SendToWorkspaceDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PromoSlot.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PromoSlot.tsx
      symbol: PromoSlot
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/CompactWorkspaceMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/CompactWorkspaceMenu.tsx
      symbol: CompactWorkspaceMenu
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/StatusBar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/StatusBar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/MultiSelectPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/MultiSelectPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SessionSharingHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SessionSharingHost.tsx
      symbol: SessionSharingHost
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/OnboardingDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/OnboardingDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/CompactSessionListFilter.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/CompactSessionListFilter.tsx
      symbol: CompactSessionListFilter
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/PanelWorkspaceMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/PanelWorkspaceMenu.tsx
      symbol: PanelWorkspaceMenu
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/TerminalPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/TerminalPanel.tsx
      symbol: TerminalPanel
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/service-navigation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/shell-width-clamp.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/auxiliary-layout.ts
      symbol: visibleWorkspacePanels
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/sidebar-registry.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/onboarding-rule-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/zen-topbar-safe-area.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/inherited-filter-params.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/skills-sidebar.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/compact-workspace-navigation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/sidebar-guidance.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/panel-route-key.ts
description: Renders the session chat transcript with streaming markdown, tool results, turn-phase bar and starter prompts.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx) | [apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx) | Invokes supplied callback: onRemoveLabel | react |
| [apps/electron/src/renderer/components/app-shell/AttachmentPreview.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/AttachmentPreview.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callbacks: onRemove, onRetryTranscription | react |
| [apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx) | [apps/electron/src/renderer/pages/ChatPage.tsx](../../../../../../apps/electron/src/renderer/pages/ChatPage.tsx) | Invokes supplied callbacks: onInputChange, onSendMessage, onSourcesChange | react |
| [apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx) | [apps/electron/src/renderer/playground/demos/mobile-webui/ChatDisplayMobilePreview.tsx](../../../../../../apps/electron/src/renderer/playground/demos/mobile-webui/ChatDisplayMobilePreview.tsx) | Invokes supplied callback: onInputChange | react |
| [apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx) | [apps/electron/src/renderer/playground/registry/edit-popover.tsx](../../../../../../apps/electron/src/renderer/playground/registry/edit-popover.tsx) | Invokes supplied callback: onSendMessage | react |
| [apps/electron/src/renderer/components/app-shell/CompactSessionMenu.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/CompactSessionMenu.tsx) | [apps/electron/src/renderer/pages/ChatPage.tsx](../../../../../../apps/electron/src/renderer/pages/ChatPage.tsx) | Invokes supplied callback: onSessionStatusChange | react |
| [apps/electron/src/renderer/components/app-shell/entity-list-virtualization.ts](../../../../../../apps/electron/src/renderer/components/app-shell/entity-list-virtualization.ts) | [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | Invokes supplied callback: getRowHeight | typescript |
| [apps/electron/src/renderer/components/app-shell/entity-list-virtualization.ts](../../../../../../apps/electron/src/renderer/components/app-shell/entity-list-virtualization.ts) | [apps/electron/src/renderer/components/ui/virtual-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/virtual-list.tsx) | Invokes supplied callback: getRowHeight | typescript |
| [apps/electron/src/renderer/components/app-shell/ProjectMultiSelectFilter.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ProjectMultiSelectFilter.tsx) | [apps/electron/src/renderer/components/pages/PagesHome.tsx](../../../../../../apps/electron/src/renderer/components/pages/PagesHome.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/app-shell/resize-controller.ts](../../../../../../apps/electron/src/renderer/components/app-shell/resize-controller.ts) | [apps/electron/src/renderer/hooks/usePanelResize.ts](../../../../../../apps/electron/src/renderer/hooks/usePanelResize.ts) | Invokes supplied callbacks: onCancel, onCommit, onPreview | typescript |
| [apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx) | [apps/electron/src/renderer/playground/proto/g06-parts.tsx](../../../../../../apps/electron/src/renderer/playground/proto/g06-parts.tsx) | Invokes supplied callbacks: onKeyAdjust, onKeyCancel, onKeyCommit, onPointerDown, onPointerMove | react |
| [apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx) | [apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx](../../../../../../apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx) | Invokes supplied callbacks: onKeyAdjust, onPointerDown | react |
| [apps/electron/src/renderer/components/app-shell/SessionItem.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionItem.tsx) | [apps/electron/src/renderer/playground/registry/project-colors.tsx](../../../../../../apps/electron/src/renderer/playground/registry/project-colors.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/app-shell/SessionItem.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionItem.tsx) | [apps/electron/src/renderer/playground/registry/session-list.tsx](../../../../../../apps/electron/src/renderer/playground/registry/session-list.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/app-shell/SessionList.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionList.tsx) | [apps/electron/src/renderer/playground/demos/mobile-webui/SessionListMobilePreview.tsx](../../../../../../apps/electron/src/renderer/playground/demos/mobile-webui/SessionListMobilePreview.tsx) | Invokes supplied callback: onSearchClose | react |
| [apps/electron/src/renderer/components/app-shell/SessionSharingHost.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionSharingHost.tsx) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callback: onSwitchWorkspace | react |
| [apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx) | [apps/electron/src/renderer/pages/tasks/TaskSidebar.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/TaskSidebar.tsx) | Invokes supplied callback: onToggle | react |
| [apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx) | [apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx](../../../../../../apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx) | Invokes supplied callback: onToggle | react |
| [apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx) | [apps/electron/src/renderer/pages/playbooks/knowledge/KnowledgeNotebookPage.tsx](../../../../../../apps/electron/src/renderer/pages/playbooks/knowledge/KnowledgeNotebookPage.tsx) | Invokes supplied callback: onDeleteSource | react |
