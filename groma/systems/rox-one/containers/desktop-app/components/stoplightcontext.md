---
type: C4 Component
title: StoplightContext
status: stable
groma:
  id: stoplightcontext
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/context/StoplightContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/StoplightContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/FocusContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/FocusContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/ModalContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/ModalContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/ThemeContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/ThemeContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/EscapeInterruptContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/EscapeInterruptContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/AppShellContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/AppShellContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/SessionListContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/SessionListContext.tsx
    - scanner: react
      file: apps/electron/src/renderer/context/DismissibleLayerContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/DismissibleLayerContext.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/context/contrast-mode.ts
    - scanner: typescript
      file: apps/electron/src/renderer/context/font-preferences.ts
    - scanner: typescript
      file: apps/electron/src/renderer/context/theme-resolution.ts
description: Propagates focused-mode state so panel headers pad around macOS traffic lights.
---
