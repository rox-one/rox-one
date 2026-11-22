---
type: C4 Component
title: Widgets
status: stable
groma:
  id: widgets
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/platform/home/widgets.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/widgets.tsx
    - scanner: react
      file: apps/electron/src/renderer/platform/home/widget-kit.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/widget-kit.tsx
    - scanner: react
      file: apps/electron/src/renderer/platform/home/today-tasks-sortable.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/today-tasks-sortable.tsx
      symbol: TodayTasksSortable
    - scanner: react
      file: apps/electron/src/renderer/platform/home/home-overview-dnd.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/home-overview-dnd.tsx
      symbol: HomeOverviewEditGrid
    - scanner: react
      file: apps/electron/src/renderer/platform/home/QuickTaskInput.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/QuickTaskInput.tsx
      symbol: QuickTaskInput
    - scanner: react
      file: apps/electron/src/renderer/platform/home/widget-appearance-controls.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/widget-appearance-controls.tsx
      symbol: WidgetAppearanceControls
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/home-actions.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/dashboard-layout.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/widget-appearance.ts
    - scanner: typescript
      file: apps/electron/src/renderer/platform/home/home-data.ts
description: Renders the Главная dashboard widgets backed by real session, task, inbox, calendar and feed data.
---
