---
type: C4 Component
title: DecisionsPage
status: stable
groma:
  id: decisionspage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/decisions/DecisionsPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/decisions/DecisionsPage.tsx
      symbol: DecisionsPage
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/decisions/decisions-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/decisions/decisions-store.ts
description: Renders the decision log with search, filters, agent-extracted candidates and workspace memory lesson sync.
---
