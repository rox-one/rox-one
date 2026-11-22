---
type: C4 Component
title: CloudHandoffButton
status: stable
groma:
  id: cloudhandoffbutton
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/cloud-handoff/CloudHandoffButton.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/cloud-handoff/CloudHandoffButton.tsx
      symbol: CloudHandoffButton
    - scanner: typescript
      file: apps/electron/src/renderer/components/cloud-handoff/handoff-state.ts
  technology: Daytona
description: Moves a chat into a Daytona cloud session and shows a browser continuation link.
---
