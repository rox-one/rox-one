---
type: C4 Component
title: Color picker
status: stable
groma:
  id: color-picker
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/ui/color-picker.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/color-picker.tsx
      symbol: ColorPicker
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-list-empty.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-list-empty.playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/HeaderMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/HeaderMenu.tsx
      symbol: HeaderMenu
    - scanner: react
      file: apps/electron/src/renderer/components/ui/rename-dialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/rename-dialog.tsx
      symbol: RenameDialog
    - scanner: react
      file: apps/electron/src/renderer/components/ui/label.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label.tsx
      symbol: Label
    - scanner: react
      file: apps/electron/src/renderer/components/ui/virtual-list.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/virtual-list.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-list-empty.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-list-empty.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-row.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-row.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/source-avatar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/source-avatar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/styled-dropdown.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/styled-dropdown.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-list.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-list.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/mention-badge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/mention-badge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/TopBarButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/TopBarButton.tsx
      symbol: TopBarButton
    - scanner: react
      file: apps/electron/src/renderer/components/ui/avatar-group.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/avatar-group.tsx
      symbol: AvatarGroup
    - scanner: react
      file: apps/electron/src/renderer/components/ui/skill-mention-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/skill-mention-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-list-badge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-list-badge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/rich-text-input.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/rich-text-input.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-icon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-icon.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/button.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/button.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/label-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/service-logo.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/service-logo.tsx
      symbol: ServiceLogo
    - scanner: react
      file: apps/electron/src/renderer/components/ui/scroll-area.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/scroll-area.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/metadata-badge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/metadata-badge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/label-value-popover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-value-popover.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/CompactWorkingDirectorySelector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/CompactWorkingDirectorySelector.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/SkillSelectorPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/SkillSelectorPopover.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/action-tooltip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/action-tooltip.tsx
      symbol: ActionTooltip
    - scanner: react
      file: apps/electron/src/renderer/components/ui/slash-command-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/slash-command-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/popover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/popover.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/select.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/select.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/input.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/input.tsx
      symbol: Input
    - scanner: react
      file: apps/electron/src/renderer/components/ui/premium-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/premium-menu.tsx
      symbol: PremiumMenu
    - scanner: react
      file: apps/electron/src/renderer/components/ui/drawer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/drawer.tsx
      symbol: Drawer
    - scanner: react
      file: apps/electron/src/renderer/components/ui/fading-text.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/fading-text.tsx
      symbol: FadingText
    - scanner: react
      file: apps/electron/src/renderer/components/ui/table.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/table.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/resizable.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/resizable.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/styled-context-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/styled-context-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/context-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/context-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/label-badge-row.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-badge-row.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/command.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/command.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/workspace-avatar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/workspace-avatar.tsx
      symbol: WorkspaceAvatar
    - scanner: react
      file: apps/electron/src/renderer/components/ui/action-menu-item.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/action-menu-item.tsx
      symbol: ActionMenuItem
    - scanner: react
      file: apps/electron/src/renderer/components/ui/dialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/dialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/tabs.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/tabs.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/inline-color-picker-row.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/inline-color-picker-row.tsx
      symbol: InlineColorPickerRow
    - scanner: react
      file: apps/electron/src/renderer/components/ui/EditPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/EditPopover.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/calendar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/calendar.tsx
      symbol: Calendar
    - scanner: react
      file: apps/electron/src/renderer/components/ui/session-status-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/session-status-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/ScrambleTagline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/ScrambleTagline.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/textarea.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/textarea.tsx
      symbol: Textarea
    - scanner: react
      file: apps/electron/src/renderer/components/ui/skill-avatar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/skill-avatar.tsx
      symbol: SkillAvatar
    - scanner: react
      file: apps/electron/src/renderer/components/ui/sortable-list.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/sortable-list.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/window-header-badge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/window-header-badge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/sonner.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/sonner.tsx
      symbol: Toaster
    - scanner: react
      file: apps/electron/src/renderer/components/ui/menu-context.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/menu-context.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/label-icon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-icon.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/HeaderIconButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/HeaderIconButton.tsx
      symbol: HeaderIconButton
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-panel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-panel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/PanelHeaderCenterButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/PanelHeaderCenterButton.tsx
      symbol: PanelHeaderCenterButton
    - scanner: react
      file: apps/electron/src/renderer/components/ui/switch.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/switch.tsx
      symbol: Switch
    - scanner: react
      file: apps/electron/src/renderer/components/ui/avatar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/avatar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/CompactSourceSelector.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/CompactSourceSelector.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/dropdown-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/dropdown-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/badge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/badge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/status-icon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/status-icon.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/kbd.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/kbd.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/collapsible.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/collapsible.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/source-status-indicator.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/source-status-indicator.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/entity-list-label-badge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-list-label-badge.tsx
      symbol: EntityListLabelBadge
    - scanner: react
      file: apps/electron/src/renderer/components/ui/label-date-editor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-date-editor.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/empty.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/empty.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/data-table.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/data-table.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/mention-menu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/mention-menu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/ui/horizontal-resize-handle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/horizontal-resize-handle.tsx
      symbol: HorizontalResizeHandle
    - scanner: react
      file: apps/electron/src/renderer/components/ui/gradient-resize-handle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/gradient-resize-handle.tsx
      symbol: GradientResizeHandle
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/long-press-state.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/entity-row-hover-slot.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-date-editor-loader.ts
      symbol: loadLabelDateEditor
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/edit-config.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/label-menu-utils.ts
    - scanner: react
      file: apps/electron/src/renderer/components/ui/separator.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/ui/separator.tsx
      symbol: Separator
  technology: react-colorful
description: Provides an in-app hex color picker popover with preset swatches, replacing the native color input.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/ui/color-picker.tsx](../../../../../../apps/electron/src/renderer/components/ui/color-picker.tsx) | [apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AppearanceSettingsPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/ui/color-picker.tsx](../../../../../../apps/electron/src/renderer/components/ui/color-picker.tsx) | [apps/electron/src/renderer/pages/settings/LabelsSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/LabelsSettingsPage.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/ui/color-picker.tsx](../../../../../../apps/electron/src/renderer/components/ui/color-picker.tsx) | [apps/electron/src/renderer/pages/settings/ThemeLayersSection.tsx](../../../../../../apps/electron/src/renderer/pages/settings/ThemeLayersSection.tsx) | Invokes supplied callback: onChange | react |
| [apps/electron/src/renderer/components/ui/CompactSourceSelector.tsx](../../../../../../apps/electron/src/renderer/components/ui/CompactSourceSelector.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callback: onToggleSlug | react |
| [apps/electron/src/renderer/components/ui/entity-list-label-badge.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list-label-badge.tsx) | [apps/electron/src/renderer/components/app-shell/SessionBadges.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionBadges.tsx) | Invokes supplied callback: onLabelsChange | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/components/app-shell/SessionList.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionList.tsx) | Invokes supplied callbacks: getKey, onEmptyGroupDragOver, onSelectGroup, onToggleCollapse, renderItem | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/components/memory/repo/MemoryRepoFilesPanel.tsx](../../../../../../apps/electron/src/renderer/components/memory/repo/MemoryRepoFilesPanel.tsx) | Invokes supplied callbacks: getKey, renderRow | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx](../../../../../../apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx) | Invokes supplied callbacks: getKey, renderRow | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/knowledge/KnowledgeHome.tsx](../../../../../../apps/electron/src/renderer/knowledge/KnowledgeHome.tsx) | Invokes supplied callbacks: getKey, renderItem | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/knowledge/KnowledgeProposals.tsx](../../../../../../apps/electron/src/renderer/knowledge/KnowledgeProposals.tsx) | Invokes supplied callbacks: getKey, renderItem | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/perf/dom-scenario.tsx](../../../../../../apps/electron/src/renderer/perf/dom-scenario.tsx) | Invokes supplied callbacks: getKey, renderItem | react |
| [apps/electron/src/renderer/components/ui/entity-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-list.tsx) | [apps/electron/src/renderer/playground/registry/entity-lists.tsx](../../../../../../apps/electron/src/renderer/playground/registry/entity-lists.tsx) | Invokes supplied callbacks: getKey, renderItem | react |
| [apps/electron/src/renderer/components/ui/entity-panel.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-panel.tsx) | [apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx) | Invokes supplied callbacks: getId, mapItem | react |
| [apps/electron/src/renderer/components/ui/entity-panel.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-panel.tsx) | [apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SourcesListPanel.tsx) | Invokes supplied callbacks: getId, mapItem | react |
| [apps/electron/src/renderer/components/ui/entity-row.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-row.tsx) | [apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ProjectsListPanel.tsx) | Invokes supplied callback: onMouseDown | react |
| [apps/electron/src/renderer/components/ui/entity-row.tsx](../../../../../../apps/electron/src/renderer/components/ui/entity-row.tsx) | [apps/electron/src/renderer/components/app-shell/SessionItem.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionItem.tsx) | Invokes supplied callbacks: compactMenu, onMouseDown | react |
| [apps/electron/src/renderer/components/ui/label-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/label-menu.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callbacks: onAddLabel, onOpenChange, onSelect, onSelectState | react |
| [apps/electron/src/renderer/components/ui/mention-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/mention-menu.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callbacks: onOpenChange, onSelect | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/components/app-shell/SessionList.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionList.tsx) | Invokes supplied callbacks: onOpenChange, onSubmit | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/pages/ChatPage.tsx](../../../../../../apps/electron/src/renderer/pages/ChatPage.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/pages/DrivePage.tsx](../../../../../../apps/electron/src/renderer/pages/DrivePage.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/pages/notes/NotesDialogs.tsx](../../../../../../apps/electron/src/renderer/pages/notes/NotesDialogs.tsx) | Invokes supplied callback: onOpenChange | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/AiSettingsPage.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx](../../../../../../apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/components/ui/rename-dialog.tsx](../../../../../../apps/electron/src/renderer/components/ui/rename-dialog.tsx) | [apps/electron/src/renderer/platform/ModeBar.tsx](../../../../../../apps/electron/src/renderer/platform/ModeBar.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/components/ui/rich-text-input.tsx](../../../../../../apps/electron/src/renderer/components/ui/rich-text-input.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callbacks: onBlur, onChange, onFocus, onInput, onKeyDown, onLongTextPaste, onPaste | react |
| [apps/electron/src/renderer/components/ui/session-status-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/session-status-menu.tsx) | [apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/ui/session-status-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/session-status-menu.tsx) | [apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx) | Invokes supplied callbacks: onClear, onSelect | react |
| [apps/electron/src/renderer/components/ui/session-status-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/session-status-menu.tsx) | [apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/ui/session-status-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/session-status-menu.tsx) | [apps/electron/src/renderer/components/app-shell/SessionStatusIcon.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SessionStatusIcon.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/ui/SkillSelectorPopover.tsx](../../../../../../apps/electron/src/renderer/components/ui/SkillSelectorPopover.tsx) | [apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx) | Invokes supplied callback: onToggleSlug | react |
| [apps/electron/src/renderer/components/ui/slash-command-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/slash-command-menu.tsx) | [apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/ActiveOptionBadges.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/ui/slash-command-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/slash-command-menu.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callbacks: onOpenChange, onSelectCommand, onSelectFolder | react |
| [apps/electron/src/renderer/components/ui/slash-command-menu.tsx](../../../../../../apps/electron/src/renderer/components/ui/slash-command-menu.tsx) | [apps/electron/src/renderer/playground/registry/slash-command.tsx](../../../../../../apps/electron/src/renderer/playground/registry/slash-command.tsx) | Invokes supplied callback: onSelect | react |
| [apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx](../../../../../../apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx) | [apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/input/FreeFormInput.tsx) | Invokes supplied callback: onToggleSlug | react |
| [apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx](../../../../../../apps/electron/src/renderer/components/ui/SourceSelectorPopover.tsx) | [apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx) | Invokes supplied callback: onToggleSlug | react |
| [apps/electron/src/renderer/components/ui/virtual-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/virtual-list.tsx) | [apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/SkillsListPanel.tsx) | Invokes supplied callbacks: getKey, renderItem | react |
| [apps/electron/src/renderer/components/ui/virtual-list.tsx](../../../../../../apps/electron/src/renderer/components/ui/virtual-list.tsx) | [apps/electron/src/renderer/pages/settings/foreign-import-picker.tsx](../../../../../../apps/electron/src/renderer/pages/settings/foreign-import-picker.tsx) | Invokes supplied callbacks: getKey, renderItem | react |
