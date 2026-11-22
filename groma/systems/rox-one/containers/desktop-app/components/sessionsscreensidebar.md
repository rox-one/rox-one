---
type: C4 Component
title: SessionsScreenSidebar
status: stable
groma:
  id: sessionsscreensidebar
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/screens/sessions/SessionsScreenSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/sessions/SessionsScreenSidebar.tsx
      symbol: SessionsScreenSidebar
    - scanner: typescript
      file: apps/electron/src/renderer/screens/sessions/sessions-projection.ts
    - scanner: typescript
      file: apps/electron/src/renderer/screens/sessions/useSessionsSidebarSections.ts
      symbol: useSessionsSidebarSections
    - scanner: typescript
      file: apps/electron/src/renderer/screens/sessions/sessions-sidebar-sections.ts
description: Publishes the Sessions second sidebar with folders, tags, search and session sharing.
---
