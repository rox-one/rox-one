---
type: C4 Component
title: Content slot
status: stable
groma:
  id: content-slot
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/screens/content-slot.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/content-slot.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/screen-sidebar-adapter.ts
    - scanner: typescript
      file: apps/electron/src/renderer/screens/sidebar-section.ts
    - scanner: react
      file: apps/electron/src/renderer/screens/ScreenSidebarHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/ScreenSidebarHost.tsx
description: Provides a portal slot letting a page inject live children into the shell sidebar without re-rendering it.
---
