---
type: C4 Component
title: KanbanBoardContainer
status: stable
groma:
  id: kanbanboardcontainer
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanBoardContainer.tsx
      symbol: KanbanBoardContainer
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/StatusBadge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/StatusBadge.tsx
      symbol: StatusBadge
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/SubtaskRow.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/SubtaskRow.tsx
      symbol: SubtaskRow
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/TaskEditor.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx
      symbol: TaskTile
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/ModelChip.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/ModelChip.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/NewTaskComposer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/NewTaskComposer.tsx
      symbol: NewTaskComposer
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/SubtaskProgress.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/SubtaskProgress.tsx
      symbol: SubtaskProgress
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanColumn.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanVirtualTaskList.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanVirtualTaskList.tsx
      symbol: KanbanVirtualTaskList
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/BoardListToggle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/BoardListToggle.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanProjectFilter.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/KanbanProjectFilter.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/status-column.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/kanban-selection.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/subtask-merge.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/kanban-grid-navigation.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/node-state-pill.ts
      symbol: resolveNodeStatePill
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/board-live-refresh.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/kanban-colors.ts
      symbol: DEFAULT_KANBAN_COLUMN_COLORS
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/task-spec-form.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/kanban-virtualization.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/types.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/priority-groups.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/kanban-column-queue.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/kanban-column-visibility.ts
      symbol: shouldHideEmptyNestedKanbanColumns
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/kanban/TaskChatPreview.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/kanban/TaskChatPreview.tsx
      symbol: TaskChatPreview
description: Renders the session kanban board with project filters, task editor and column auto-run.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/KanbanBoard.tsx) | [apps/electron/src/renderer/playground/registry/kanban.tsx](../../../../../../apps/electron/src/renderer/playground/registry/kanban.tsx) | Invokes supplied callback: onMoveTask | react |
| [apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx](../../../../../../apps/electron/src/renderer/components/app-shell/kanban/TaskTile.tsx) | [apps/electron/src/renderer/playground/registry/kanban.tsx](../../../../../../apps/electron/src/renderer/playground/registry/kanban.tsx) | Invokes supplied callbacks: onClick, onRunSubtasks, onToggleSubtasks | react |
