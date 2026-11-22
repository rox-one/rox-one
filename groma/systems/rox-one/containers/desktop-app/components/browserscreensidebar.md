---
type: C4 Component
title: BrowserScreenSidebar
status: stable
groma:
  id: browserscreensidebar
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/screens/browser/BrowserScreenSidebar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/screens/browser/BrowserScreenSidebar.tsx
      symbol: BrowserScreenSidebar
    - scanner: typescript
      file: apps/electron/src/renderer/screens/browser/browser-sidebar-sections.ts
description: Publishes the Browser second sidebar with open tabs, bookmarks and recent history.
---
