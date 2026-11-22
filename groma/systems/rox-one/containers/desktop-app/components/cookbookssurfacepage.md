---
type: C4 Component
title: CookbooksSurfacePage
status: stable
groma:
  id: cookbookssurfacepage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/CookbooksSurfacePage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/find-replace.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/cell-history.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/cell-selection.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/scroll-spy.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/live-stream.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/cookbooks/output-text.ts
      symbol: normalizeOutputText
  technology: Python sidecar
description: Renders the native cookbooks catalog and notebook-style document runner over sidecar IPC.
---
