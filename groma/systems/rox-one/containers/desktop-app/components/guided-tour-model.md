---
type: C4 Component
title: Model
status: stable
groma:
  id: guided-tour-model
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/features/guided-tour/model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/guided-tour/state.ts
    - scanner: react
      file: apps/electron/src/renderer/features/guided-tour/GuidedTour.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/guided-tour/GuidedTour.tsx
description: Defines the guided spotlight tour steps, target selectors and version for first-run onboarding.
---
