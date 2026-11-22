---
type: C4 Component
title: SessionFilesSection
status: stable
groma:
  id: sessionfilessection
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/right-sidebar/SessionFilesSection.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/right-sidebar/session-files-watch.ts
      symbol: restoreSessionFileWatch
description: Renders the session directory as a watched, expandable file tree with preview and native actions.
---
