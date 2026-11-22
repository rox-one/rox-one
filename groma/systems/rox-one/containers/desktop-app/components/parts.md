---
type: C4 Component
title: Parts
status: stable
groma:
  id: parts
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/parts.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/parts.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/TaskSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/TaskSidebar.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/TaskDetail.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/TaskDetail.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/MoveDialog.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/MoveDialog.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/TimelinePanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/TimelinePanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/TaskDependencies.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/TaskDependencies.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/BulkActionBar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/BulkActionBar.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/QuickEntry.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/QuickEntry.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/CatalogPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/CatalogPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/pages/tasks/TaskTimeline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/TaskTimeline.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/drafts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/atoms.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/presentation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/delegation-errors.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/magic-plus.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/task-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/timeline-adapters.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/multi-select.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/use-task-detail-drafts.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/bulk-actions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/tasks/timeline-model.ts
description: 'Provides small shared building blocks for the Задачи screen: checkbox, progress pie, dialogs and month calendar.'
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/pages/tasks/BulkActionBar.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/BulkActionBar.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callback: onAction | react |
| [apps/electron/src/renderer/pages/tasks/MoveDialog.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/MoveDialog.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callback: onPick | react |
| [apps/electron/src/renderer/pages/tasks/parts.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/parts.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callback: onToggle | react |
| [apps/electron/src/renderer/pages/tasks/QuickEntry.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/QuickEntry.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callback: onSubmit | react |
| [apps/electron/src/renderer/pages/tasks/TaskDetail.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/TaskDetail.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callbacks: onClose, onDraftChange, onDraftSubmit, onOpenSession, onOpenSource | react |
| [apps/electron/src/renderer/pages/tasks/TaskSidebar.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/TaskSidebar.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callbacks: dropProps, listCount, onToggleArea | react |
| [apps/electron/src/renderer/pages/tasks/TaskTimeline.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/TaskTimeline.tsx) | [apps/electron/src/renderer/pages/TasksPage.tsx](../../../../../../apps/electron/src/renderer/pages/TasksPage.tsx) | Invokes supplied callbacks: groupTitle, onSchedule, onSelect | react |
| [apps/electron/src/renderer/pages/tasks/TimelinePanel.tsx](../../../../../../apps/electron/src/renderer/pages/tasks/TimelinePanel.tsx) | [apps/electron/src/renderer/pages/workspace-work/WorkspaceTasksView.tsx](../../../../../../apps/electron/src/renderer/pages/workspace-work/WorkspaceTasksView.tsx) | Invokes supplied callback: onSelect | react |
