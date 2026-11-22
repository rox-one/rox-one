---
type: C4 Component
title: G06 lanes playground
status: stable
groma:
  id: g06-lanes-playground
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/playground/proto/g06-lanes.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/proto/g06-lanes.playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/proto/g06-lens.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/proto/g06-lens.playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/proto/g06-parts.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/proto/g06-parts.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/proto/g06-panels.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/proto/g06-panels.playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground/proto/g06-workbench.playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground/proto/g06-workbench.playground.tsx
description: Playground story presenting the session list as dense status lanes with rules and keyboard traversal.
---
