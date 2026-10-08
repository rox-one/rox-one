# Golden Gate: машинный индекс компонентов

База `22c8b89858f8c41d3f687f13d49a31b55045c146`. Дата: 2026-09-14. Уровень C — чтение TypeScript AST, без визуальной проверки.

[INVENTORY.json](INVENTORY.json) содержит 575 исходных TSX-файлов, 501 объявлений Props и 45 route builders. Для каждого файла записаны exports, точный текст объявленных Props, JSX tags и используемые названия attributes (без данных пользователей). Это не runtime screenshot и не доказательство успешного выполнения.

Индекс охватывает Electron renderer и shared UI; тестовые файлы исключены. Playground и вспомогательные компоненты включены явно. Наследуемые React/Radix/HTML props и props из spread не разворачиваются автоматически: `has_spread_attributes=true` требует проверки контракта родителя. Реально зарегистрированные экраны/состояния и требования к эффективным control properties находятся в [SCREEN-MATRIX.md](SCREEN-MATRIX.md).

## Семейства и точные файлы

### actions (1)

- `apps/electron/src/renderer/actions/registry.tsx`

### browser-preview (1)

- `apps/electron/src/renderer/browser-preview/BrowserPreview.tsx`

### components (6)

- `apps/electron/src/renderer/components/AppMenu.tsx`
- `apps/electron/src/renderer/components/KeyboardShortcuts.tsx`
- `apps/electron/src/renderer/components/KeyboardShortcutsDialog.tsx` — `KeyboardShortcutsDialogProps`
- `apps/electron/src/renderer/components/ResetConfirmationDialog.tsx` — `ResetConfirmationDialogProps`
- `apps/electron/src/renderer/components/ServerDirectoryBrowser.tsx` — `ServerDirectoryBrowserProps`
- `apps/electron/src/renderer/components/SplashScreen.tsx` — `SplashScreenProps`

### components/apisetup (2)

- `apps/electron/src/renderer/components/apisetup/ApiKeyInput.tsx` — `ApiKeyInputProps`
- `apps/electron/src/renderer/components/apisetup/OAuthConnect.tsx` — `OAuthConnectProps`

### components/app-menu (4)

- `apps/electron/src/renderer/components/app-menu/DesktopAppMenu.tsx`
- `apps/electron/src/renderer/components/app-menu/MobileAppMenu.tsx` — `SheetProps`, `PageStackProps`
- `apps/electron/src/renderer/components/app-menu/MobileMenuItem.tsx` — `MobileMenuItemProps`
- `apps/electron/src/renderer/components/app-menu/MobileMenuPage.tsx` — `MobileMenuPageProps`

### components/app-shell (61)

- `apps/electron/src/renderer/components/app-shell/AccountMenu.tsx` — `AccountMenuProps`
- `apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx` — `ActiveOptionBadgesProps`, `PermissionModeDropdownProps`
- `apps/electron/src/renderer/components/app-shell/ActiveTasksBar.tsx` — `ActiveTasksBarProps`
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — `AppShellProps`
- `apps/electron/src/renderer/components/app-shell/AttachmentPreview.tsx` — `AttachmentPreviewProps`, `AttachmentBubbleProps`
- `apps/electron/src/renderer/components/app-shell/BackgroundFinishedChip.tsx` — `BackgroundFinishedChipProps`
- `apps/electron/src/renderer/components/app-shell/BatchSessionMenu.tsx` — `BatchSessionMenuProps`
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` — `ChatDisplayProps`, `ProcessingIndicatorProps`, `MessageBubbleProps`
- `apps/electron/src/renderer/components/app-shell/CompactPanelTransition.tsx` — `CompactPanelTransitionProps`
- `apps/electron/src/renderer/components/app-shell/CompactSessionListFilter.tsx` — `CompactSessionListFilterProps`
- `apps/electron/src/renderer/components/app-shell/CompactSessionMenu.tsx` — `CompactSessionMenuProps`, `RootPaneProps`, `RowProps`
- `apps/electron/src/renderer/components/app-shell/EntityViewTabs.tsx` — `EntityViewTabsProps`, `EntityViewPlaceholderProps`
- `apps/electron/src/renderer/components/app-shell/FabNewChat.tsx` — `FabNewChatProps`
- `apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx` — `LeftSidebarProps`, `SortableStatusListProps`, `SidebarButtonProps`
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` — `MainContentPanelProps`
- `apps/electron/src/renderer/components/app-shell/MemoryListPanel.tsx` — `MemoryListPanelProps`
- `apps/electron/src/renderer/components/app-shell/MemoryProposalCard.tsx` — `MemoryProposalCardProps`, `SessionMemoryProposalLaneProps`
- `apps/electron/src/renderer/components/app-shell/MemoryProvenanceStrip.tsx` — `MemoryProvenanceStripProps`
- `apps/electron/src/renderer/components/app-shell/MiniDashboardCards.tsx` — `MiniDashboardCardsProps`
- `apps/electron/src/renderer/components/app-shell/MultiSelectPanel.tsx` — `MultiSelectPanelProps`
- `apps/electron/src/renderer/components/app-shell/NavigatorPanel.tsx` — `NavigatorPanelProps`
- `apps/electron/src/renderer/components/app-shell/OnboardingDialog.tsx` — `OnboardingDialogProps`
- `apps/electron/src/renderer/components/app-shell/Panel.tsx` — `PanelProps`
- `apps/electron/src/renderer/components/app-shell/PanelHeader.tsx` — `CompactChatHeaderProps`, `PanelHeaderProps`
- `apps/electron/src/renderer/components/app-shell/PanelResizeSash.tsx` — `PanelResizeSashProps`
- `apps/electron/src/renderer/components/app-shell/PanelSlot.tsx` — `PanelSlotProps`
- `apps/electron/src/renderer/components/app-shell/PanelStackContainer.tsx` — `PanelStackContainerProps`
- `apps/electron/src/renderer/components/app-shell/ProfileStrip.tsx` — `ProfileStripProps`
- `apps/electron/src/renderer/components/app-shell/ProjectMultiSelectFilter.tsx` — `ProjectMultiSelectFilterProps`
- `apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx` — `ProjectsListPanelProps`, `ProjectRowProps`
- `apps/electron/src/renderer/components/app-shell/PromoSlot.tsx` — `PromoSlotProps`
- `apps/electron/src/renderer/components/app-shell/QuestProgressCard.tsx` — `QuestProgressCardProps`
- `apps/electron/src/renderer/components/app-shell/ResizeHandle.tsx` — `ResizeHandleProps`
- `apps/electron/src/renderer/components/app-shell/SendResourceToWorkspaceDialog.tsx` — `SendResourceToWorkspaceDialogProps`
- `apps/electron/src/renderer/components/app-shell/SendToWorkspaceDialog.tsx` — `SendToWorkspaceDialogProps`
- `apps/electron/src/renderer/components/app-shell/SessionBadges.tsx` — `SessionBadgesProps`
- `apps/electron/src/renderer/components/app-shell/SessionInfoPopover.tsx` — `SessionInfoPopoverProps`
- `apps/electron/src/renderer/components/app-shell/SessionItem.tsx` — `SessionItemProps`
- `apps/electron/src/renderer/components/app-shell/SessionList.tsx` — `SessionListProps`
- `apps/electron/src/renderer/components/app-shell/SessionMenu.tsx` — `SessionMenuProps`
- `apps/electron/src/renderer/components/app-shell/SessionMenuParts.tsx` — `ShareMenuItemsProps`, `StatusMenuItemsProps`, `LabelMenuItemsProps`
- `apps/electron/src/renderer/components/app-shell/SessionPresenceAvatars.tsx` — `SessionPresenceAvatarsProps`
- `apps/electron/src/renderer/components/app-shell/SessionProjectColorWrapper.tsx` — `SessionProjectColorWrapperProps`
- `apps/electron/src/renderer/components/app-shell/SessionRatingPill.tsx` — `SessionRatingPillProps`
- `apps/electron/src/renderer/components/app-shell/SessionSearchHeader.tsx` — `SessionSearchHeaderProps`
- `apps/electron/src/renderer/components/app-shell/SessionStatusIcon.tsx` — `SessionStatusIconProps`
- `apps/electron/src/renderer/components/app-shell/SessionViewTabs.tsx` — `SessionViewTabsProps`, `SessionViewPlaceholderProps`
- `apps/electron/src/renderer/components/app-shell/SetupAuthBanner.tsx` — `SetupAuthBannerProps`
- `apps/electron/src/renderer/components/app-shell/SidebarChrome.tsx` — `SidebarChromeProps`
- `apps/electron/src/renderer/components/app-shell/SidebarDisclosure.tsx` — `SidebarDisclosureButtonProps`
- `apps/electron/src/renderer/components/app-shell/SidebarMenu.tsx` — `SidebarMenuProps`
- `apps/electron/src/renderer/components/app-shell/SkillMenu.tsx` — `SkillMenuProps`
- `apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx` — `SkillsListPanelProps`
- `apps/electron/src/renderer/components/app-shell/SourceMenu.tsx` — `SourceMenuProps`
- `apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx` — `SourcesListPanelProps`
- `apps/electron/src/renderer/components/app-shell/TaskActionMenu.tsx` — `TaskActionMenuProps`
- `apps/electron/src/renderer/components/app-shell/ToolchainStatusBanner.tsx`
- `apps/electron/src/renderer/components/app-shell/TopBar.tsx` — `TopBarProps`
- `apps/electron/src/renderer/components/app-shell/TransportConnectionBanner.tsx`
- `apps/electron/src/renderer/components/app-shell/WhatsNewTimeline.tsx` — `WhatsNewTimelineProps`
- `apps/electron/src/renderer/components/app-shell/WorkspaceIconRail.tsx` — `WorkspaceIconRailProps`

### components/app-shell/collection (10)

- `apps/electron/src/renderer/components/app-shell/collection/CollectionBulkBar.tsx` — `CollectionBulkBarProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionBulkMenu.tsx` — `CollectionBulkMenuProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionDisplayPopover.tsx` — `CollectionDisplayPopoverProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionFilterChips.tsx` — `CollectionFilterChipsProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionFilterMenu.tsx` — `CollectionFilterMenuProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionGroupByMenu.tsx`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionOpsBar.tsx` — `CollectionOpsBarProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionViewChrome.tsx` — `CollectionViewChromeProps`
- `apps/electron/src/renderer/components/app-shell/collection/CollectionViewCycleButton.tsx` — `CollectionViewCycleButtonProps`
- `apps/electron/src/renderer/components/app-shell/collection/collection-menu-row.tsx`

### components/app-shell/input (12)

- `apps/electron/src/renderer/components/app-shell/input/ChatInputZone.tsx` — `ChatInputZoneProps`
- `apps/electron/src/renderer/components/app-shell/input/CompactModelSelector.tsx` — `CompactModelSelectorProps`
- `apps/electron/src/renderer/components/app-shell/input/CompactPermissionModeSelector.tsx` — `CompactPermissionModeSelectorProps`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx` — `FreeFormInputProps`
- `apps/electron/src/renderer/components/app-shell/input/FreeFormInputContextBadge.tsx` — `FreeFormInputContextBadgeProps`
- `apps/electron/src/renderer/components/app-shell/input/ImageSupportWarningBanner.tsx` — `ImageSupportWarningBannerProps`
- `apps/electron/src/renderer/components/app-shell/input/InputContainer.tsx` — `InputContainerProps`
- `apps/electron/src/renderer/components/app-shell/input/InputErrorBoundary.tsx` — `InputErrorBoundaryProps`
- `apps/electron/src/renderer/components/app-shell/input/StructuredInput.tsx` — `StructuredInputProps`
- `apps/electron/src/renderer/components/app-shell/input/ToolbarStatusSlot.tsx` — `ToolbarStatusSlotProps`
- `apps/electron/src/renderer/components/app-shell/input/VoiceDictationControl.tsx` — `VoiceDictationControlProps`
- `apps/electron/src/renderer/components/app-shell/input/WorkingDirectorySelector.tsx` — `WorkingDirectorySelectorProps`

### components/app-shell/input/structured (3)

- `apps/electron/src/renderer/components/app-shell/input/structured/AdminApprovalRequest.tsx` — `AdminApprovalRequestProps`
- `apps/electron/src/renderer/components/app-shell/input/structured/CredentialRequest.tsx` — `CredentialRequestProps`
- `apps/electron/src/renderer/components/app-shell/input/structured/PermissionRequest.tsx` — `PermissionRequestProps`

### components/app-shell/kanban (14)

- `apps/electron/src/renderer/components/app-shell/kanban/BoardListToggle.tsx`
- `apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.tsx` — `KanbanBoardProps`
- `apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx`
- `apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx` — `KanbanColumnProps`, `TileSharedProps`
- `apps/electron/src/renderer/components/app-shell/kanban/KanbanProjectFilter.tsx` — `KanbanProjectFilterProps`
- `apps/electron/src/renderer/components/app-shell/kanban/KanbanVirtualTaskList.tsx`
- `apps/electron/src/renderer/components/app-shell/kanban/ModelChip.tsx` — `ModelChipProps`
- `apps/electron/src/renderer/components/app-shell/kanban/NewTaskComposer.tsx` — `NewTaskComposerProps`
- `apps/electron/src/renderer/components/app-shell/kanban/StatusBadge.tsx` — `StatusBadgeProps`
- `apps/electron/src/renderer/components/app-shell/kanban/SubtaskProgress.tsx` — `SubtaskProgressProps`
- `apps/electron/src/renderer/components/app-shell/kanban/SubtaskRow.tsx` — `SubtaskRowProps`
- `apps/electron/src/renderer/components/app-shell/kanban/TaskChatPreview.tsx` — `TaskChatPreviewProps`
- `apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx` — `TaskEditorProps`
- `apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx` — `TaskTileProps`

### components/app-shell/session-heatmap (1)

- `apps/electron/src/renderer/components/app-shell/session-heatmap/SessionHeatmapHost.tsx`

### components/app-shell/session-table (3)

- `apps/electron/src/renderer/components/app-shell/session-table/SessionTableGroupHeader.tsx` — `SessionTableGroupHeaderProps`
- `apps/electron/src/renderer/components/app-shell/session-table/SessionTableHost.tsx`
- `apps/electron/src/renderer/components/app-shell/session-table/SessionTableRow.tsx` — `SessionTableRowProps`

### components/automations (15)

- `apps/electron/src/renderer/components/automations/ActionTypeIcon.tsx`
- `apps/electron/src/renderer/components/automations/AutomationActionPreview.tsx` — `AutomationActionPreviewProps`
- `apps/electron/src/renderer/components/automations/AutomationActionRow.tsx` — `AutomationActionRowProps`
- `apps/electron/src/renderer/components/automations/AutomationAvatar.tsx` — `AutomationAvatarProps`
- `apps/electron/src/renderer/components/automations/AutomationCard.tsx` — `AutomationCardProps`
- `apps/electron/src/renderer/components/automations/AutomationEventTimeline.tsx` — `AutomationEventTimelineProps`
- `apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx` — `AutomationGraphEditorProps`
- `apps/electron/src/renderer/components/automations/AutomationGraphWorkspaceEditor.tsx` — `AutomationGraphWorkspaceEditorProps`
- `apps/electron/src/renderer/components/automations/AutomationInfoPage.tsx` — `AutomationInfoPageProps`
- `apps/electron/src/renderer/components/automations/AutomationMenu.tsx` — `AutomationMenuProps`
- `apps/electron/src/renderer/components/automations/AutomationTestPanel.tsx` — `AutomationTestPanelProps`
- `apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx` — `AutomationItemProps`, `AutomationsListPanelProps`
- `apps/electron/src/renderer/components/automations/BatchAutomationMenu.tsx`
- `apps/electron/src/renderer/components/automations/CronBuilder.tsx` — `CronFieldProps`, `CronBuilderProps`
- `apps/electron/src/renderer/components/automations/PhaseBadge.tsx` — `PhaseBadgeProps`

### components/browser (5)

- `apps/electron/src/renderer/components/browser/BrowserTabBadge.tsx` — `BrowserTabBadgeProps`
- `apps/electron/src/renderer/components/browser/BrowserTabStrip.tsx` — `BrowserTabStripProps`
- `apps/electron/src/renderer/components/browser/BrowserToolbar.tsx` — `BrowserToolbarProps`
- `apps/electron/src/renderer/components/browser/ElementInspectConfirm.tsx` — `ElementInspectConfirmProps`
- `apps/electron/src/renderer/components/browser/WebBrowserPanel.tsx` — `WebBrowserPanelProps`

### components/calendar (2)

- `apps/electron/src/renderer/components/calendar/CalendarConnectorChips.tsx`
- `apps/electron/src/renderer/components/calendar/CalendarStatusStrip.tsx`

### components/chat (4)

- `apps/electron/src/renderer/components/chat/AuthRequestCard.tsx` — `AuthCardHeaderProps`, `AuthCardActionsProps`, `AuthRequestCardProps`
- `apps/electron/src/renderer/components/chat/EmptyStateHint.tsx` — `EntityBadgeProps`, `EmptyStateHintProps`
- `apps/electron/src/renderer/components/chat/MagicPromptChip.tsx` — `MagicPromptChipProps`
- `apps/electron/src/renderer/components/chat/SideThreadPreviewDialog.tsx` — `SideThreadPreviewDialogProps`

### components/cloud-runs (1)

- `apps/electron/src/renderer/components/cloud-runs/CloudRunsChip.tsx` — `CloudRunsChipProps`

### components/files (1)

- `apps/electron/src/renderer/components/files/FileViewer.tsx` — `FileViewerProps`

### components/icons (10)

- `apps/electron/src/renderer/components/icons/ConnectionIcon.tsx` — `ConnectionIconProps`
- `apps/electron/src/renderer/components/icons/CraftAgentsLogo.tsx` — `CraftAgentsLogoProps`
- `apps/electron/src/renderer/components/icons/CraftAgentsSymbol.tsx` — `CraftAgentsSymbolProps`
- `apps/electron/src/renderer/components/icons/CraftAppIcon.tsx` — `CraftAppIconProps`
- `apps/electron/src/renderer/components/icons/McpIcon.tsx`
- `apps/electron/src/renderer/components/icons/PanelLeftRounded.tsx`
- `apps/electron/src/renderer/components/icons/PanelRightRounded.tsx`
- `apps/electron/src/renderer/components/icons/SettingsIcons.tsx` — `IconProps`
- `apps/electron/src/renderer/components/icons/SquarePenRounded.tsx`
- `apps/electron/src/renderer/components/icons/TodoStateIcons.tsx`

### components/info (13)

- `apps/electron/src/renderer/components/info/AutoRulesDataTable.tsx` — `AutoRulesDataTableProps`
- `apps/electron/src/renderer/components/info/Info_Alert.tsx` — `Info_AlertProps`
- `apps/electron/src/renderer/components/info/Info_Badge.tsx` — `Info_BadgeProps`
- `apps/electron/src/renderer/components/info/Info_DataTable.tsx` — `Info_DataTableProps`
- `apps/electron/src/renderer/components/info/Info_GroupedList.tsx` — `Info_GroupedListProps`, `Info_GroupedListGroupProps`, `Info_GroupedListItemProps`
- `apps/electron/src/renderer/components/info/Info_Markdown.tsx` — `Info_MarkdownProps`
- `apps/electron/src/renderer/components/info/Info_Page.tsx` — `Info_PageProps`, `Info_PageHeaderProps`, `Info_PageHeroProps`, `Info_PageContentProps`
- `apps/electron/src/renderer/components/info/Info_Section.tsx` — `Info_SectionProps`
- `apps/electron/src/renderer/components/info/Info_StatusBadge.tsx` — `Info_StatusBadgeProps`
- `apps/electron/src/renderer/components/info/Info_Table.tsx` — `Info_TableProps`, `Info_TableRowProps`
- `apps/electron/src/renderer/components/info/LabelsDataTable.tsx` — `LabelsDataTableProps`
- `apps/electron/src/renderer/components/info/PermissionsDataTable.tsx` — `PermissionsDataTableProps`
- `apps/electron/src/renderer/components/info/ToolsDataTable.tsx` — `ToolsDataTableProps`

### components/knowledge (3)

- `apps/electron/src/renderer/components/knowledge/PublishSessionDialog.tsx` — `PublishSessionDialogProps`
- `apps/electron/src/renderer/components/knowledge/PublishSessionDialogHost.tsx`
- `apps/electron/src/renderer/components/knowledge/SessionPublishedChip.tsx` — `SessionPublishedChipProps`

### components/markdown (1)

- `apps/electron/src/renderer/components/markdown/StreamingMarkdown.tsx` — `StreamingMarkdownProps`

### components/messaging (10)

- `apps/electron/src/renderer/components/messaging/DiscordConnectDialog.tsx` — `DiscordConnectDialogProps`
- `apps/electron/src/renderer/components/messaging/LarkConnectDialog.tsx` — `LarkConnectDialogProps`
- `apps/electron/src/renderer/components/messaging/MessagingDialogHost.tsx`
- `apps/electron/src/renderer/components/messaging/MessagingPlatformIcon.tsx` — `MessagingPlatformIconProps`
- `apps/electron/src/renderer/components/messaging/MessagingSessionMenuItem.tsx` — `MessagingSessionMenuItemProps`
- `apps/electron/src/renderer/components/messaging/PairingCodeDialog.tsx` — `PairingCodeDialogProps`
- `apps/electron/src/renderer/components/messaging/TelegramConnectDialog.tsx` — `TelegramConnectDialogProps`
- `apps/electron/src/renderer/components/messaging/TelegramSupergroupPairingDialog.tsx` — `Props`
- `apps/electron/src/renderer/components/messaging/WeChatConnectDialog.tsx` — `WeChatConnectDialogProps`
- `apps/electron/src/renderer/components/messaging/WhatsAppConnectDialog.tsx` — `WhatsAppConnectDialogProps`

### components/messaging/access (5)

- `apps/electron/src/renderer/components/messaging/access/AccessModeBanner.tsx` — `Props`
- `apps/electron/src/renderer/components/messaging/access/BindingAllowListPopover.tsx` — `Props`
- `apps/electron/src/renderer/components/messaging/access/OwnersListEditor.tsx` — `Props`
- `apps/electron/src/renderer/components/messaging/access/PendingSendersList.tsx` — `Props`
- `apps/electron/src/renderer/components/messaging/access/TelegramAccessSection.tsx` — `Props`

### components/notes (1)

- `apps/electron/src/renderer/components/notes/NotesImportButton.tsx` — `NotesImportButtonProps`

### components/onboarding (14)

- `apps/electron/src/renderer/components/onboarding/APISetupStep.tsx` — `APISetupStepProps`
- `apps/electron/src/renderer/components/onboarding/CompletionStep.tsx` — `CompletionStepProps`
- `apps/electron/src/renderer/components/onboarding/CredentialsStep.tsx` — `CredentialsStepProps`
- `apps/electron/src/renderer/components/onboarding/EnvironmentFields.tsx` — `EnvironmentFieldsProps`
- `apps/electron/src/renderer/components/onboarding/EnvironmentSetupStep.tsx` — `EnvironmentSetupStepProps`
- `apps/electron/src/renderer/components/onboarding/GitBashWarning.tsx` — `GitBashWarningProps`
- `apps/electron/src/renderer/components/onboarding/LocalModelStep.tsx` — `LocalModelStepProps`
- `apps/electron/src/renderer/components/onboarding/OmpCredentialStep.tsx` — `OmpCredentialStepProps`
- `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx` — `OnboardingWizardProps`
- `apps/electron/src/renderer/components/onboarding/ProviderSelectStep.tsx` — `ProviderSelectStepProps`
- `apps/electron/src/renderer/components/onboarding/ReauthScreen.tsx` — `ReauthScreenProps`
- `apps/electron/src/renderer/components/onboarding/RoxConnectStep.tsx` — `RoxConnectStepProps`
- `apps/electron/src/renderer/components/onboarding/WelcomeStep.tsx` — `WelcomeStepProps`
- `apps/electron/src/renderer/components/onboarding/primitives.tsx` — `StepIconProps`, `StepHeaderProps`, `StepFormLayoutProps`, `StepActionsProps`, `BackButtonProps`, `ContinueButtonProps`

### components/pages (11)

- `apps/electron/src/renderer/components/pages/DeletePageDialog.tsx` — `DeletePageDialogProps`
- `apps/electron/src/renderer/components/pages/PageFrame.tsx` — `PageFrameProps`
- `apps/electron/src/renderer/components/pages/PageGrantRequestDialog.tsx` — `PageGrantRequestDialogProps`
- `apps/electron/src/renderer/components/pages/PageGrantsDialog.tsx` — `PageGrantsDialogProps`
- `apps/electron/src/renderer/components/pages/PageSourceAuthBanner.tsx` — `PageSourceAuthBannerProps`
- `apps/electron/src/renderer/components/pages/PageTile.tsx` — `PageTileProps`
- `apps/electron/src/renderer/components/pages/PageView.tsx` — `PageViewProps`
- `apps/electron/src/renderer/components/pages/PagesHome.tsx`
- `apps/electron/src/renderer/components/pages/SharePageDialog.tsx` — `SharePageDialogProps`
- `apps/electron/src/renderer/components/pages/grant-visuals.tsx`
- `apps/electron/src/renderer/components/pages/page-visuals.tsx`

### components/preview (1)

- `apps/electron/src/renderer/components/preview/TableOfContents.tsx` — `TableOfContentsProps`

### components/projects (2)

- `apps/electron/src/renderer/components/projects/CreateProjectDialog.tsx` — `CreateProjectDialogProps`
- `apps/electron/src/renderer/components/projects/ProjectIcon.tsx` — `ProjectIconProps`

### components/right-sidebar (1)

- `apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx` — `SessionFilesSectionProps`, `FileTreeItemProps`

### components/session-inspector (6)

- `apps/electron/src/renderer/components/session-inspector/BottomTerminalDock.tsx`
- `apps/electron/src/renderer/components/session-inspector/InspectorBrowserPane.tsx`
- `apps/electron/src/renderer/components/session-inspector/InspectorTerminal.tsx`
- `apps/electron/src/renderer/components/session-inspector/SessionContextPanel.tsx`
- `apps/electron/src/renderer/components/session-inspector/SessionGitPanel.tsx`
- `apps/electron/src/renderer/components/session-inspector/SessionInspectorBody.tsx`

### components/session-workbench (8)

- `apps/electron/src/renderer/components/session-workbench/PlaybookHoleList.tsx`
- `apps/electron/src/renderer/components/session-workbench/RepoArchitectureExplainer.tsx`
- `apps/electron/src/renderer/components/session-workbench/RightSessionShell.tsx`
- `apps/electron/src/renderer/components/session-workbench/SceneNode.tsx`
- `apps/electron/src/renderer/components/session-workbench/SessionFanOutSheet.tsx`
- `apps/electron/src/renderer/components/session-workbench/SessionGitOutline.tsx` — `SessionGitOutlineProps`
- `apps/electron/src/renderer/components/session-workbench/SessionWorkbench.tsx` — `SessionWorkbenchProps`
- `apps/electron/src/renderer/components/session-workbench/SessionWorkflowEditor.tsx` — `SessionWorkflowEditorProps`

### components/settings (14)

- `apps/electron/src/renderer/components/settings/CommandGatewaySection.tsx` — `CommandGatewaySectionProps`
- `apps/electron/src/renderer/components/settings/OpenClawAuditSection.tsx` — `OpenClawAuditSectionProps`
- `apps/electron/src/renderer/components/settings/SearchableModelInput.tsx` — `SearchableModelInputProps`
- `apps/electron/src/renderer/components/settings/SettingsCard.tsx` — `SettingsCardProps`
- `apps/electron/src/renderer/components/settings/SettingsEditRow.tsx` — `SettingsEditRowProps`
- `apps/electron/src/renderer/components/settings/SettingsInput.tsx` — `SettingsInputProps`, `SettingsInputRowProps`, `SettingsSecretInputProps`
- `apps/electron/src/renderer/components/settings/SettingsMenuSelect.tsx` — `SettingsMenuSelectProps`, `SettingsMenuSelectRowProps`
- `apps/electron/src/renderer/components/settings/SettingsRadioGroup.tsx` — `SettingsRadioGroupProps`, `SettingsRadioCardProps`, `SettingsRadioOptionProps`
- `apps/electron/src/renderer/components/settings/SettingsRow.tsx` — `SettingsRowProps`
- `apps/electron/src/renderer/components/settings/SettingsSection.tsx` — `SettingsSectionProps`, `SettingsGroupProps`, `SettingsDividerProps`
- `apps/electron/src/renderer/components/settings/SettingsSegmentedControl.tsx` — `SettingsSegmentedControlProps`, `SettingsSegmentedControlCardProps`
- `apps/electron/src/renderer/components/settings/SettingsSelect.tsx` — `SettingsSelectProps`, `SettingsSelectRowProps`
- `apps/electron/src/renderer/components/settings/SettingsTextarea.tsx` — `SettingsTextareaProps`
- `apps/electron/src/renderer/components/settings/SettingsToggle.tsx` — `SettingsToggleProps`

### components/shiki (3)

- `apps/electron/src/renderer/components/shiki/ShikiCodeEditor.tsx` — `ShikiCodeEditorProps`
- `apps/electron/src/renderer/components/shiki/ShikiCodeViewer.tsx` — `ShikiCodeViewerProps`
- `apps/electron/src/renderer/components/shiki/ShikiDiffViewer.tsx` — `ShikiDiffViewerProps`

### components/ui (72)

- `apps/electron/src/renderer/components/ui/CompactSourceSelector.tsx` — `CompactSourceSelectorProps`
- `apps/electron/src/renderer/components/ui/CompactWorkingDirectorySelector.tsx` — `CompactWorkingDirectorySelectorProps`
- `apps/electron/src/renderer/components/ui/EditPopover.tsx` — `EditPopoverProps`
- `apps/electron/src/renderer/components/ui/HeaderIconButton.tsx` — `HeaderIconButtonProps`
- `apps/electron/src/renderer/components/ui/HeaderMenu.tsx` — `HeaderMenuProps`
- `apps/electron/src/renderer/components/ui/PanelHeaderCenterButton.tsx` — `PanelHeaderCenterButtonProps`
- `apps/electron/src/renderer/components/ui/SkillSelectorPopover.tsx` — `SkillSelectorPopoverProps`
- `apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx` — `SourceSelectorPopoverProps`
- `apps/electron/src/renderer/components/ui/TopBarButton.tsx` — `TopBarButtonProps`
- `apps/electron/src/renderer/components/ui/action-menu-item.tsx` — `ActionMenuItemProps`
- `apps/electron/src/renderer/components/ui/action-tooltip.tsx` — `ActionTooltipProps`
- `apps/electron/src/renderer/components/ui/avatar-group.tsx` — `AvatarGroupProps`
- `apps/electron/src/renderer/components/ui/avatar.tsx` — `CrossfadeAvatarProps`
- `apps/electron/src/renderer/components/ui/badge.tsx` — `BadgeProps`
- `apps/electron/src/renderer/components/ui/button.tsx` — `ButtonProps`
- `apps/electron/src/renderer/components/ui/calendar.tsx`
- `apps/electron/src/renderer/components/ui/collapsible.tsx` — `AnimatedCollapsibleContentProps`
- `apps/electron/src/renderer/components/ui/color-picker.tsx` — `ColorPickerProps`
- `apps/electron/src/renderer/components/ui/command.tsx`
- `apps/electron/src/renderer/components/ui/context-menu.tsx`
- `apps/electron/src/renderer/components/ui/data-table.tsx` — `DataTableProps`, `SortableHeaderProps`
- `apps/electron/src/renderer/components/ui/dialog.tsx`
- `apps/electron/src/renderer/components/ui/drawer.tsx`
- `apps/electron/src/renderer/components/ui/dropdown-menu.tsx`
- `apps/electron/src/renderer/components/ui/empty.tsx`
- `apps/electron/src/renderer/components/ui/entity-icon.tsx` — `EntityIconProps`
- `apps/electron/src/renderer/components/ui/entity-list-badge.tsx` — `EntityListBadgeProps`
- `apps/electron/src/renderer/components/ui/entity-list-empty.tsx` — `EntityListEmptyScreenProps`
- `apps/electron/src/renderer/components/ui/entity-list-label-badge.tsx` — `EntityListLabelBadgeProps`
- `apps/electron/src/renderer/components/ui/entity-list.tsx` — `EntityListProps`
- `apps/electron/src/renderer/components/ui/entity-panel.tsx` — `EntityPanelProps`
- `apps/electron/src/renderer/components/ui/entity-row.tsx` — `EntityRowProps`
- `apps/electron/src/renderer/components/ui/fading-text.tsx` — `FadingTextProps`
- `apps/electron/src/renderer/components/ui/gradient-resize-handle.tsx` — `GradientResizeHandleProps`
- `apps/electron/src/renderer/components/ui/horizontal-resize-handle.tsx` — `HorizontalResizeHandleProps`
- `apps/electron/src/renderer/components/ui/inline-color-picker-row.tsx` — `InlineColorPickerRowProps`
- `apps/electron/src/renderer/components/ui/input.tsx`
- `apps/electron/src/renderer/components/ui/kbd.tsx`
- `apps/electron/src/renderer/components/ui/label-badge-row.tsx` — `LabelBadgeRowProps`
- `apps/electron/src/renderer/components/ui/label-icon.tsx` — `LabelIconProps`, `LabelValueTypeIconProps`
- `apps/electron/src/renderer/components/ui/label-menu.tsx` — `InlineLabelMenuProps`
- `apps/electron/src/renderer/components/ui/label-value-popover.tsx` — `LabelValuePopoverProps`
- `apps/electron/src/renderer/components/ui/label.tsx`
- `apps/electron/src/renderer/components/ui/mention-badge.tsx` — `MentionBadgeProps`, `ActiveMentionBadgesProps`
- `apps/electron/src/renderer/components/ui/mention-menu.tsx` — `InlineMentionMenuProps`
- `apps/electron/src/renderer/components/ui/menu-context.tsx`
- `apps/electron/src/renderer/components/ui/metadata-badge.tsx` — `MetadataBadgeProps`
- `apps/electron/src/renderer/components/ui/popover.tsx`
- `apps/electron/src/renderer/components/ui/rename-dialog.tsx` — `RenameDialogProps`
- `apps/electron/src/renderer/components/ui/resizable.tsx`
- `apps/electron/src/renderer/components/ui/rich-text-input.tsx` — `RichTextInputProps`, `RotatingPlaceholderProps`
- `apps/electron/src/renderer/components/ui/scroll-area.tsx` — `ScrollAreaProps`
- `apps/electron/src/renderer/components/ui/select.tsx`
- `apps/electron/src/renderer/components/ui/separator.tsx`
- `apps/electron/src/renderer/components/ui/service-logo.tsx` — `ServiceLogoProps`
- `apps/electron/src/renderer/components/ui/session-status-menu.tsx` — `SessionStatusMenuProps`
- `apps/electron/src/renderer/components/ui/skill-avatar.tsx` — `SkillAvatarProps`
- `apps/electron/src/renderer/components/ui/skill-mention-menu.tsx` — `InlineSkillMentionProps`
- `apps/electron/src/renderer/components/ui/slash-command-menu.tsx` — `PermissionModeIconProps`, `SlashCommandMenuProps`, `InlineSlashCommandProps`
- `apps/electron/src/renderer/components/ui/sonner.tsx`
- `apps/electron/src/renderer/components/ui/sortable-list.tsx` — `SortableListProps`, `SortableItemWrapperProps`
- `apps/electron/src/renderer/components/ui/source-avatar.tsx` — `SourceAvatarProps`
- `apps/electron/src/renderer/components/ui/source-status-indicator.tsx` — `SourceStatusIndicatorProps`
- `apps/electron/src/renderer/components/ui/status-icon.tsx` — `StatusIconProps`
- `apps/electron/src/renderer/components/ui/styled-context-menu.tsx` — `StyledContextMenuContentProps`, `StyledContextMenuItemProps`, `StyledContextMenuSubContentProps`
- `apps/electron/src/renderer/components/ui/styled-dropdown.tsx`
- `apps/electron/src/renderer/components/ui/switch.tsx`
- `apps/electron/src/renderer/components/ui/table.tsx` — `TableProps`
- `apps/electron/src/renderer/components/ui/tabs.tsx`
- `apps/electron/src/renderer/components/ui/textarea.tsx`
- `apps/electron/src/renderer/components/ui/window-header-badge.tsx`
- `apps/electron/src/renderer/components/ui/workspace-avatar.tsx` — `WorkspaceAvatarProps`

### components/views (1)

- `apps/electron/src/renderer/components/views/ViewPurposeList.tsx`

### components/workspace (9)

- `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_Choice.tsx` — `AddWorkspaceStep_ChoiceProps`, `ChoiceCardProps`
- `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_ConnectRemote.tsx` — `AddWorkspaceStep_ConnectRemoteProps`
- `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_CreateNew.tsx` — `AddWorkspaceStep_CreateNewProps`
- `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_OpenFolder.tsx` — `AddWorkspaceStep_OpenFolderProps`
- `apps/electron/src/renderer/components/workspace/AddWorkspaceStep_Ssh.tsx` — `AddWorkspaceStep_SshProps`
- `apps/electron/src/renderer/components/workspace/AddWorkspace_RadioOption.tsx` — `AddWorkspace_RadioOptionProps`
- `apps/electron/src/renderer/components/workspace/WorkspaceCreationScreen.tsx` — `WorkspaceCreationScreenProps`
- `apps/electron/src/renderer/components/workspace/WorkspacePicker.tsx` — `WorkspacePickerProps`
- `apps/electron/src/renderer/components/workspace/primitives.tsx` — `AddWorkspaceContainerProps`, `AddWorkspaceStepHeaderProps`, `AddWorkspacePrimaryButtonProps`, `AddWorkspaceSecondaryButtonProps`

### config (1)

- `apps/electron/src/renderer/config/session-status-config.tsx`

### context (8)

- `apps/electron/src/renderer/context/AppShellContext.tsx`
- `apps/electron/src/renderer/context/DismissibleLayerContext.tsx`
- `apps/electron/src/renderer/context/EscapeInterruptContext.tsx`
- `apps/electron/src/renderer/context/FocusContext.tsx`
- `apps/electron/src/renderer/context/ModalContext.tsx`
- `apps/electron/src/renderer/context/SessionListContext.tsx`
- `apps/electron/src/renderer/context/StoplightContext.tsx`
- `apps/electron/src/renderer/context/ThemeContext.tsx` — `ThemeProviderProps`

### contexts (1)

- `apps/electron/src/renderer/contexts/NavigationContext.tsx` — `NavigationProviderProps`

### knowledge (7)

- `apps/electron/src/renderer/knowledge/KnowledgeAgentPanel.tsx` — `KnowledgeAgentPanelProps`
- `apps/electron/src/renderer/knowledge/KnowledgeDiff.tsx`
- `apps/electron/src/renderer/knowledge/KnowledgeHome.tsx`
- `apps/electron/src/renderer/knowledge/KnowledgeInspector.tsx` — `KnowledgeInspectorProps`
- `apps/electron/src/renderer/knowledge/KnowledgeNavigator.tsx` — `KnowledgeNavigatorProps`
- `apps/electron/src/renderer/knowledge/KnowledgeNotebookTree.tsx`
- `apps/electron/src/renderer/knowledge/KnowledgeProposals.tsx`

### mindmap (2)

- `apps/electron/src/renderer/mindmap/MindMapHost.tsx` — `MindMapHostProps`
- `apps/electron/src/renderer/mindmap/MindMapOutline.tsx` — `MindMapOutlineProps`

### mindmap/engine (2)

- `apps/electron/src/renderer/mindmap/engine/minimap.tsx` — `MindMapMinimapProps`
- `apps/electron/src/renderer/mindmap/engine/svg-engine.tsx` — `SvgMindMapViewProps`

### pages (13)

- `apps/electron/src/renderer/pages/BrowserPanelPage.tsx` — `BrowserPanelPageProps`
- `apps/electron/src/renderer/pages/ChatPage.tsx` — `ChatPageProps`
- `apps/electron/src/renderer/pages/ConnectionsPage.tsx`
- `apps/electron/src/renderer/pages/ExtensionSurfacePage.tsx` — `ExtensionSurfacePageProps`
- `apps/electron/src/renderer/pages/KnowledgeEntityPage.tsx` — `KnowledgeEntityPageProps`
- `apps/electron/src/renderer/pages/KnowledgeSurfacePage.tsx` — `KnowledgeSurfacePageProps`
- `apps/electron/src/renderer/pages/MeetingsPage.tsx`
- `apps/electron/src/renderer/pages/NotesPage.tsx` — `NotesPageProps`, `FolderTreeItemProps`
- `apps/electron/src/renderer/pages/ProjectInfoPage.tsx` — `ProjectInfoPageProps`
- `apps/electron/src/renderer/pages/ShortcutsPage.tsx`
- `apps/electron/src/renderer/pages/SkillInfoPage.tsx` — `SkillInfoPageProps`
- `apps/electron/src/renderer/pages/SourceInfoPage.tsx` — `SourceInfoPageProps`
- `apps/electron/src/renderer/pages/TasksPage.tsx`

### pages/meetings (3)

- `apps/electron/src/renderer/pages/meetings/ConationPanels.tsx` — `ConationPanelProps`
- `apps/electron/src/renderer/pages/meetings/MeetingDetail.tsx`
- `apps/electron/src/renderer/pages/meetings/ProposalInbox.tsx`

### pages/notes (8)

- `apps/electron/src/renderer/pages/notes/NoteInspector.tsx` — `NoteInspectorProps`
- `apps/electron/src/renderer/pages/notes/NotesAIMenu.tsx` — `NotesAIMenuProps`
- `apps/electron/src/renderer/pages/notes/NotesDialogs.tsx` — `NotesDialogsProps`
- `apps/electron/src/renderer/pages/notes/NotesDocumentChrome.tsx`
- `apps/electron/src/renderer/pages/notes/NotesReadingChrome.tsx`
- `apps/electron/src/renderer/pages/notes/NotesViewHost.tsx`
- `apps/electron/src/renderer/pages/notes/VaultIndexHealthPanel.tsx`
- `apps/electron/src/renderer/pages/notes/VaultInsightsPanel.tsx`

### pages/settings (34)

- `apps/electron/src/renderer/pages/settings/AccountSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/AccountsSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx` — `CredentialHealthBannerProps`, `ConnectionRowProps`, `WorkspaceOverrideCardProps`
- `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/BrowserProfileImportPanel.tsx`
- `apps/electron/src/renderer/pages/settings/CloudRunsSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/ConationShellSettings.tsx`
- `apps/electron/src/renderer/pages/settings/ContextSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/CredentialMigrationCard.tsx`
- `apps/electron/src/renderer/pages/settings/EnvironmentSettingsSection.tsx`
- `apps/electron/src/renderer/pages/settings/ExtensionsSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/ImportSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/InputSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/KnowledgeSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/LabelsSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/MarketplaceSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/MessagingSettingsPage.tsx` — `TelegramBindingsBodyProps`
- `apps/electron/src/renderer/pages/settings/OrganizationsSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/PermissionsSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/PreferencesPage.tsx`
- `apps/electron/src/renderer/pages/settings/PrivacySettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/RuntimeSettingsPage.tsx` — `ToolRowProps`
- `apps/electron/src/renderer/pages/settings/SecretRefsSection.tsx`
- `apps/electron/src/renderer/pages/settings/SecuritySettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/ServerSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/SettingsNavigator.tsx` — `SettingsNavigatorProps`, `SettingsItemRowProps`
- `apps/electron/src/renderer/pages/settings/SettingsOverviewPage.tsx`
- `apps/electron/src/renderer/pages/settings/ShortcutsPage.tsx`
- `apps/electron/src/renderer/pages/settings/VoiceSettingsSection.tsx`
- `apps/electron/src/renderer/pages/settings/WorkbenchChromeSettings.tsx`
- `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx`
- `apps/electron/src/renderer/pages/settings/ZenShellSettings.tsx`
- `apps/electron/src/renderer/pages/settings/secret-refs-ui.tsx`

### pages/settings/security (1)

- `apps/electron/src/renderer/pages/settings/security/SecuritySnake.tsx` — `SecuritySnakeProps`

### platform (13)

- `apps/electron/src/renderer/platform/ActivityRail.tsx`
- `apps/electron/src/renderer/platform/HomeFrontPage.tsx`
- `apps/electron/src/renderer/platform/InspectorHost.tsx`
- `apps/electron/src/renderer/platform/KnowledgeInspectorPanel.tsx`
- `apps/electron/src/renderer/platform/ModeBar.tsx`
- `apps/electron/src/renderer/platform/Omnibox.tsx` — `OmniboxProps`
- `apps/electron/src/renderer/platform/OmniboxHost.tsx`
- `apps/electron/src/renderer/platform/PanelHost.tsx` — `PanelHostProps`
- `apps/electron/src/renderer/platform/StatusBarHost.tsx`
- `apps/electron/src/renderer/platform/SurfaceTabs.tsx`
- `apps/electron/src/renderer/platform/WorkspaceSurfaceHost.tsx` — `WorkspaceSurfaceHostProps`
- `apps/electron/src/renderer/platform/index.tsx`
- `apps/electron/src/renderer/platform/terminal-xterm.tsx`

### platform/conation (5)

- `apps/electron/src/renderer/platform/conation/ConationBoardPanel.tsx` — `Props`
- `apps/electron/src/renderer/platform/conation/ConationFundPanel.tsx` — `Props`
- `apps/electron/src/renderer/platform/conation/ConationInspectorPanel.tsx`
- `apps/electron/src/renderer/platform/conation/ConationMailPanel.tsx` — `Props`
- `apps/electron/src/renderer/platform/conation/ConationNotesPanel.tsx` — `Props`

### playground (6)

- `apps/electron/src/renderer/playground/ComponentPreview.tsx` — `ComponentPreviewProps`
- `apps/electron/src/renderer/playground/PlaygroundApp.tsx`
- `apps/electron/src/renderer/playground/PlaygroundAppShellProvider.tsx`
- `apps/electron/src/renderer/playground/Sidebar.tsx` — `SidebarProps`
- `apps/electron/src/renderer/playground/ThemeToggle.tsx`
- `apps/electron/src/renderer/playground/VariantsSidebar.tsx` — `VariantsSidebarProps`, `PropControlProps`

### playground/adapters (1)

- `apps/electron/src/renderer/playground/adapters/input-adapters.tsx` — `PermissionRequestPlaygroundProps`, `AdminApprovalRequestPlaygroundProps`

### playground/demos (1)

- `apps/electron/src/renderer/playground/demos/OnboardingFlowDemo.tsx`

### playground/demos/messaging (6)

- `apps/electron/src/renderer/playground/demos/messaging/AllowListPreview.tsx` — `AllowListPreviewProps`
- `apps/electron/src/renderer/playground/demos/messaging/MessagingSettingsPagePreview.tsx` — `MessagingSettingsPagePreviewProps`
- `apps/electron/src/renderer/playground/demos/messaging/MessagingSubmenuPreview.tsx` — `MessagingSubmenuPreviewProps`
- `apps/electron/src/renderer/playground/demos/messaging/MessagingTelegramReworkedPreview.tsx` — `MessagingTelegramReworkedPreviewProps`
- `apps/electron/src/renderer/playground/demos/messaging/PairingCodeDialogPreview.tsx` — `PairingCodeDialogPreviewProps`
- `apps/electron/src/renderer/playground/demos/messaging/WhatsAppConnectDialogPreview.tsx` — `WhatsAppConnectDialogPreviewProps`

### playground/demos/mobile-webui (6)

- `apps/electron/src/renderer/playground/demos/mobile-webui/AppMenuMobilePreview.tsx` — `AppMenuMobilePreviewProps`
- `apps/electron/src/renderer/playground/demos/mobile-webui/ChatDisplayMobilePreview.tsx` — `ChatDisplayMobilePreviewProps`
- `apps/electron/src/renderer/playground/demos/mobile-webui/KnowledgeMobilePreview.tsx` — `KnowledgeMobilePreviewProps`
- `apps/electron/src/renderer/playground/demos/mobile-webui/MobilePlaygroundProviders.tsx` — `HydrateProps`, `MobileAppShellOverrideProps`, `MobilePlaygroundProvidersProps`
- `apps/electron/src/renderer/playground/demos/mobile-webui/MobileWebUIFrame.tsx` — `MobileWebUIFrameProps`
- `apps/electron/src/renderer/playground/demos/mobile-webui/SessionListMobilePreview.tsx` — `SessionListMobilePreviewProps`

### playground/registry (34)

- `apps/electron/src/renderer/playground/registry/api-key-input.tsx`
- `apps/electron/src/renderer/playground/registry/automations.tsx`
- `apps/electron/src/renderer/playground/registry/browser-ui.tsx` — `BrowserTraceSidebarSampleProps`
- `apps/electron/src/renderer/playground/registry/chat.tsx` — `InputContainerPlaygroundProps`, `ActiveTasksBarContextProps`, `PermissionInputToggleProps`
- `apps/electron/src/renderer/playground/registry/collection.tsx`
- `apps/electron/src/renderer/playground/registry/container-transitions.tsx` — `IslandOptionsProps`, `ToolbarToConfirmTransitionDemoProps`
- `apps/electron/src/renderer/playground/registry/custom-shadows.tsx`
- `apps/electron/src/renderer/playground/registry/edit-popover.tsx` — `CompactChatPreviewProps`, `EditPopoverPreviewProps`
- `apps/electron/src/renderer/playground/registry/entity-lists.tsx` — `EntityRowPreviewProps`, `SessionEntityListPreviewProps`, `SourceEntityListPreviewProps`, `SkillEntityListPreviewProps`, `MixedEntityListPreviewProps`, `InteractiveEntityListPreviewProps`
- `apps/electron/src/renderer/playground/registry/icons.tsx`
- `apps/electron/src/renderer/playground/registry/image-support.tsx` — `PickerRowProps`
- `apps/electron/src/renderer/playground/registry/input.tsx`
- `apps/electron/src/renderer/playground/registry/kanban.tsx` — `TaskWindowProps`
- `apps/electron/src/renderer/playground/registry/label-badges.tsx` — `LabelBadgeRowPlaygroundProps`
- `apps/electron/src/renderer/playground/registry/markdown.tsx`
- `apps/electron/src/renderer/playground/registry/messages.tsx` — `ProcessingIndicatorProps`
- `apps/electron/src/renderer/playground/registry/messaging.tsx`
- `apps/electron/src/renderer/playground/registry/mobile-webui.tsx`
- `apps/electron/src/renderer/playground/registry/notes.tsx`
- `apps/electron/src/renderer/playground/registry/oauth.tsx`
- `apps/electron/src/renderer/playground/registry/onboarding.tsx`
- `apps/electron/src/renderer/playground/registry/planner.tsx`
- `apps/electron/src/renderer/playground/registry/premium-menu.tsx`
- `apps/electron/src/renderer/playground/registry/project-colors.tsx` — `ProjectColorsPreviewProps`
- `apps/electron/src/renderer/playground/registry/session-list.tsx` — `SessionListSearchPreviewProps`, `SessionItemPreviewProps`
- `apps/electron/src/renderer/playground/registry/settings.tsx`
- `apps/electron/src/renderer/playground/registry/slash-command.tsx`
- `apps/electron/src/renderer/playground/registry/task-editor.tsx`
- `apps/electron/src/renderer/playground/registry/toasts.tsx`
- `apps/electron/src/renderer/playground/registry/transport-banner.tsx`
- `apps/electron/src/renderer/playground/registry/turn-card-modes.tsx`
- `apps/electron/src/renderer/playground/registry/turn-card.tsx`
- `apps/electron/src/renderer/playground/registry/unified-shell.tsx` — `HydrateShellProps`, `UnifiedShellDemoProps`
- `apps/electron/src/renderer/playground/registry/zen-shell-qa.tsx`

### renderer-root (6)

- `apps/electron/src/renderer/App.tsx`
- `apps/electron/src/renderer/browser-empty-state.tsx`
- `apps/electron/src/renderer/browser-toolbar.tsx`
- `apps/electron/src/renderer/main.tsx`
- `apps/electron/src/renderer/playground.tsx`
- `apps/electron/src/renderer/voice-overlay.tsx`

### shared-ui/components (1)

- `packages/ui/src/components/tooltip.tsx`

### shared-ui/components/annotations (2)

- `packages/ui/src/components/annotations/AnnotationIslandMenu.tsx` — `AnnotationIslandMenuProps`
- `packages/ui/src/components/annotations/AnnotationOverlayLayer.tsx` — `AnnotationOverlayLayerProps`

### shared-ui/components/chat (12)

- `packages/ui/src/components/chat/AcceptPlanDropdown.tsx` — `AcceptPlanDropdownProps`
- `packages/ui/src/components/chat/CompactAcceptPlanDrawer.tsx` — `CompactAcceptPlanDrawerProps`
- `packages/ui/src/components/chat/InlineExecution.tsx` — `InlineExecutionProps`
- `packages/ui/src/components/chat/MessageHoverDock.tsx` — `MessageHoverDockProps`
- `packages/ui/src/components/chat/SessionViewer.tsx` — `SessionViewerProps`
- `packages/ui/src/components/chat/SideThreadMenu.tsx` — `SideThreadMenuProps`
- `packages/ui/src/components/chat/SystemMessage.tsx` — `SystemMessageProps`
- `packages/ui/src/components/chat/ThinkingCard.tsx` — `ThinkingCardProps`
- `packages/ui/src/components/chat/TurnCard.tsx` — `TurnCardProps`, `ActivityRowProps`, `ActivityGroupRowProps`, `ResponseCardProps`, `BranchDropdownProps`, `TodoListProps`
- `packages/ui/src/components/chat/TurnCardActionsMenu.tsx` — `TurnCardActionsMenuProps`
- `packages/ui/src/components/chat/UserMessageBubble.tsx` — `UserMessageBubbleProps`
- `packages/ui/src/components/chat/attachment-helpers.tsx` — `FileTypeIconProps`

### shared-ui/components/code-viewer (5)

- `packages/ui/src/components/code-viewer/DiffIcons.tsx` — `IconProps`
- `packages/ui/src/components/code-viewer/DiffViewerControls.tsx` — `DiffViewerControlsProps`
- `packages/ui/src/components/code-viewer/ShikiCodeViewer.tsx` — `ShikiCodeViewerProps`
- `packages/ui/src/components/code-viewer/ShikiDiffViewer.tsx` — `ShikiDiffViewerProps`
- `packages/ui/src/components/code-viewer/UnifiedDiffViewer.tsx` — `UnifiedDiffViewerProps`

### shared-ui/components/icons (3)

- `packages/ui/src/components/icons/Folder.tsx`
- `packages/ui/src/components/icons/Home.tsx`
- `packages/ui/src/components/icons/Inbox.tsx`

### shared-ui/components/markdown (23)

- `packages/ui/src/components/markdown/CodeBlock.tsx` — `CodeBlockProps`
- `packages/ui/src/components/markdown/CollapsibleMarkdownContext.tsx` — `CollapsibleMarkdownProviderProps`
- `packages/ui/src/components/markdown/CollapsibleSection.tsx` — `CollapsibleSectionProps`
- `packages/ui/src/components/markdown/ImageCardStack.tsx` — `ImageCardStackProps`, `StackImageProps`
- `packages/ui/src/components/markdown/Markdown.tsx` — `MarkdownProps`
- `packages/ui/src/components/markdown/MarkdownDatatableBlock.tsx` — `MarkdownDatatableBlockProps`
- `packages/ui/src/components/markdown/MarkdownDiffBlock.tsx` — `MarkdownDiffBlockProps`
- `packages/ui/src/components/markdown/MarkdownDocBlock.tsx` — `MarkdownDocBlockProps`
- `packages/ui/src/components/markdown/MarkdownHtmlBlock.tsx` — `MarkdownHtmlBlockProps`
- `packages/ui/src/components/markdown/MarkdownImageBlock.tsx` — `MarkdownImageBlockProps`
- `packages/ui/src/components/markdown/MarkdownJsonBlock.tsx` — `MarkdownJsonBlockProps`
- `packages/ui/src/components/markdown/MarkdownLatexBlock.tsx` — `MarkdownLatexBlockProps`
- `packages/ui/src/components/markdown/MarkdownMermaidBlock.tsx` — `MarkdownMermaidBlockProps`
- `packages/ui/src/components/markdown/MarkdownPdfBlock.tsx` — `MarkdownPdfBlockProps`
- `packages/ui/src/components/markdown/MarkdownSpreadsheetBlock.tsx` — `MarkdownSpreadsheetBlockProps`
- `packages/ui/src/components/markdown/RichBlockShell.tsx` — `RichBlockShellProps`
- `packages/ui/src/components/markdown/SourcedStatement.tsx` — `SourcedStatementProps`
- `packages/ui/src/components/markdown/TableExportDropdown.tsx` — `TableExportDropdownProps`
- `packages/ui/src/components/markdown/TiptapBubbleMenus.tsx`
- `packages/ui/src/components/markdown/TiptapCodeBlockView.tsx` — `TiptapCodeBlockViewProps`
- `packages/ui/src/components/markdown/TiptapHoverActions.tsx` — `TiptapHoverActionsHostProps`, `TiptapHoverActionsProps`, `TiptapHoverActionButtonProps`
- `packages/ui/src/components/markdown/TiptapMarkdownEditor.tsx` — `TiptapMarkdownEditorProps`
- `packages/ui/src/components/markdown/safe-components.tsx`

### shared-ui/components/markdown/extensions (3)

- `packages/ui/src/components/markdown/extensions/LatexBlock.tsx`
- `packages/ui/src/components/markdown/extensions/MermaidBlock.tsx`
- `packages/ui/src/components/markdown/extensions/TiptapImageBlock.tsx` — `TiptapImageNodeViewProps`

### shared-ui/components/overlay (21)

- `packages/ui/src/components/overlay/ActivityCardsOverlay.tsx` — `ActivityCardsOverlayProps`
- `packages/ui/src/components/overlay/AnnotatableMarkdownDocument.tsx` — `AnnotatableMarkdownDocumentProps`
- `packages/ui/src/components/overlay/CodePreviewOverlay.tsx` — `CodePreviewOverlayProps`
- `packages/ui/src/components/overlay/ContentFrame.tsx` — `ContentFrameProps`
- `packages/ui/src/components/overlay/CopyButton.tsx` — `CopyButtonProps`
- `packages/ui/src/components/overlay/DataTableOverlay.tsx` — `DataTableOverlayProps`
- `packages/ui/src/components/overlay/DocumentFormattedMarkdownOverlay.tsx` — `DocumentFormattedMarkdownOverlayProps`
- `packages/ui/src/components/overlay/FullscreenOverlayBase.tsx` — `FullscreenOverlayBaseProps`
- `packages/ui/src/components/overlay/FullscreenOverlayBaseHeader.tsx` — `FullscreenOverlayBaseHeaderProps`, `FilePathBadgeProps`
- `packages/ui/src/components/overlay/GenericOverlay.tsx` — `GenericOverlayProps`
- `packages/ui/src/components/overlay/HTMLPreviewOverlay.tsx` — `HTMLPreviewOverlayProps`
- `packages/ui/src/components/overlay/ImagePreviewOverlay.tsx` — `ImagePreviewOverlayProps`
- `packages/ui/src/components/overlay/ItemNavigator.tsx` — `ItemNavigatorProps`
- `packages/ui/src/components/overlay/JSONPreviewOverlay.tsx` — `JSONPreviewOverlayProps`
- `packages/ui/src/components/overlay/MermaidPreviewOverlay.tsx` — `MermaidPreviewOverlayProps`
- `packages/ui/src/components/overlay/MultiDiffPreviewOverlay.tsx` — `MultiDiffPreviewOverlayProps`
- `packages/ui/src/components/overlay/OverlayErrorBanner.tsx` — `OverlayErrorBannerProps`
- `packages/ui/src/components/overlay/PDFPreviewOverlay.tsx` — `PDFPreviewOverlayProps`
- `packages/ui/src/components/overlay/PreviewOverlay.tsx` — `PreviewOverlayProps`
- `packages/ui/src/components/overlay/TerminalPreviewOverlay.tsx` — `TerminalPreviewOverlayProps`
- `packages/ui/src/components/overlay/ZoomControls.tsx` — `ZoomControlsProps`

### shared-ui/components/terminal (1)

- `packages/ui/src/components/terminal/TerminalOutput.tsx` — `TerminalOutputProps`

### shared-ui/components/ui (13)

- `packages/ui/src/components/ui/BrowserControls.tsx` — `NavButtonProps`, `BrowserControlsProps`
- `packages/ui/src/components/ui/BrowserEmptyStateCard.tsx` — `BrowserEmptyStateCardProps`
- `packages/ui/src/components/ui/BrowserShader.tsx` — `BrowserShaderProps`
- `packages/ui/src/components/ui/FilterableSelectPopover.tsx` — `FilterableSelectPopoverProps`
- `packages/ui/src/components/ui/Island.tsx` — `IslandContentViewProps`, `IslandProps`
- `packages/ui/src/components/ui/IslandFollowUpContentView.tsx` — `IslandFollowUpContentViewProps`
- `packages/ui/src/components/ui/LoadingIndicator.tsx` — `SpinnerProps`, `LoadingIndicatorProps`
- `packages/ui/src/components/ui/PremiumMenu.tsx` — `PremiumMenuProps`
- `packages/ui/src/components/ui/PremiumMenuSelect.tsx` — `PremiumMenuSelectProps`
- `packages/ui/src/components/ui/PreviewHeader.tsx` — `PreviewHeaderBadgeProps`, `PreviewHeaderProps`
- `packages/ui/src/components/ui/SimpleDropdown.tsx` — `SimpleDropdownItemProps`, `SimpleDropdownProps`
- `packages/ui/src/components/ui/StyledDropdown.tsx` — `DropdownMenuTriggerProps`, `StyledDropdownMenuContentProps`, `StyledDropdownMenuItemProps`, `StyledDropdownMenuSubContentProps`
- `packages/ui/src/components/ui/drawer.tsx`

### shared-ui/context (2)

- `packages/ui/src/context/PlatformContext.tsx` — `PlatformProviderProps`
- `packages/ui/src/context/ShikiThemeContext.tsx` — `ShikiThemeProviderProps`

