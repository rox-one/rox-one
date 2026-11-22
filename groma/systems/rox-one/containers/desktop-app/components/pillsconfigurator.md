---
type: C4 Component
title: PillsConfigurator
status: stable
groma:
  id: pillsconfigurator
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/shell/PillsConfigurator.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/PillsConfigurator.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/shell/PillsTopBarConfigurator.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/PillsTopBarConfigurator.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/shell/PillsSettings.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/PillsSettings.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/shell/SidebarSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/SidebarSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/panel-strip.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/pills.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/inspector-prefs.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/shell-prefs.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/screen-sidebar.ts
    - scanner: react
      file: apps/electron/src/renderer/components/shell/NotificationPanel.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/NotificationPanel.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/shell/NotificationCenter.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/NotificationCenter.tsx
      symbol: NotificationCenter
    - scanner: react
      file: apps/electron/src/renderer/components/shell/SplitToggle.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/SplitToggle.tsx
      symbol: SplitToggle
    - scanner: react
      file: apps/electron/src/renderer/components/shell/PrimaryRail.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/PrimaryRail.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/shell/ScreenSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/ScreenSidebar.tsx
    - scanner: react
      file: apps/electron/src/renderer/components/shell/OneTimeHint.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/OneTimeHint.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/rail-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/notifications.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/narrow-overlay.ts
      symbol: useNarrowOverlayFocus
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/notification-panel-loader.ts
      symbol: loadNotificationPanel
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/split-mode.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/shell/notification-sources.ts
description: Lets users choose and reorder the top shell pills with drag-and-drop and keyboard controls.
---
