---
type: C4 Component
title: FileViewer
status: stable
groma:
  id: fileviewer
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/files/FileViewer.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/files/FileViewer.tsx
      symbol: FileViewer
description: Loads and displays a file's text content by path with loading and error states.
---
