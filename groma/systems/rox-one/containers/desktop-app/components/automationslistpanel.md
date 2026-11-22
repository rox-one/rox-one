---
type: C4 Component
title: AutomationsListPanel
status: stable
groma:
  id: automationslistpanel
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/ContextBindingEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/ContextBindingEditor.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationEditor.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/BatchAutomationMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/BatchAutomationMenu.tsx
      symbol: BatchAutomationMenu
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationGraphWorkspaceEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationGraphWorkspaceEditor.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationGraphEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/automations-sidebar.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/constants.ts
      symbol: DEFAULT_WEBHOOK_METHOD
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/schedule-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/utils.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/useAutomationContextCatalog.ts
      symbol: useAutomationContextCatalog
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/graph-fit-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/types.ts
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationEventTimeline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationEventTimeline.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationCard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationCard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationMenu.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationMenu.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationInfoPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationInfoPage.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationActionPreview.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationActionPreview.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationActionRow.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationActionRow.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/PhaseBadge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/PhaseBadge.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/ActionTypeIcon.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/ActionTypeIcon.tsx
      symbol: ActionTypeIcon
    - scanner: react
      file: apps/electron/src/renderer/components/automations/CronBuilder.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/CronBuilder.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationTestPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationTestPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/automations/AutomationAvatar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/automations/AutomationAvatar.tsx
description: Lists automations grouped by trigger type with search, run status and enable switches.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/automations/AutomationCard.tsx](../../../../../../apps/electron/src/renderer/components/automations/AutomationCard.tsx) | [apps/electron/src/renderer/playground/registry/automations.tsx](../../../../../../apps/electron/src/renderer/playground/registry/automations.tsx) | Invokes supplied callback: onToggleEnabled | react |
| [apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx](../../../../../../apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx) | [apps/electron/src/renderer/components/app-shell/AppShell.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/AppShell.tsx) | Invokes supplied callback: onAutomationClick | react |
| [apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx](../../../../../../apps/electron/src/renderer/components/automations/AutomationsListPanel.tsx) | [apps/electron/src/renderer/playground/registry/automations.tsx](../../../../../../apps/electron/src/renderer/playground/registry/automations.tsx) | Invokes supplied callbacks: onAutomationClick, onToggleAutomation | react |
