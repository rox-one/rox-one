---
type: C4 Component
title: FocusPage
status: stable
groma:
  id: focuspage
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/pages/extra-screens/focus/FocusPage.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/focus/FocusPage.tsx
      symbol: FocusPage
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/focus/focus-summary.ts
    - scanner: typescript
      file: apps/electron/src/renderer/pages/extra-screens/focus/focus-model.ts
description: Renders the daily focus screen combining calendar, top tasks, inbox items and a deep-work timer.
---
