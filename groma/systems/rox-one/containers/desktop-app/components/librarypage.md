---
type: C4 Component
title: LibraryPage
status: stable
groma:
  id: librarypage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/library/LibraryPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/library/LibraryPage.tsx
      symbol: LibraryPage
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/library/library-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/library/use-library-index.ts
description: Renders the six-section catalog screen for skills, sources, MCP tools, connections, integrations and extensions.
---
