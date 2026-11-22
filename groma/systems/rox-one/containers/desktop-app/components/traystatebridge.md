---
type: C4 Component
title: TrayStateBridge
status: stable
groma:
  id: traystatebridge
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/features/native-integrations/TrayStateBridge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/native-integrations/TrayStateBridge.tsx
    - scanner: react
      file: apps/electron/src/renderer/features/native-integrations/ShellActionBridge.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/native-integrations/ShellActionBridge.tsx
      symbol: ShellActionBridge
    - scanner: react
      file: apps/electron/src/renderer/features/native-integrations/QuickComposerSurface.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/features/native-integrations/QuickComposerSurface.tsx
      symbol: QuickComposerSurface
    - scanner: typescript
      file: apps/electron/src/renderer/features/native-integrations/accelerator.ts
    - scanner: typescript
      file: apps/electron/src/renderer/features/native-integrations/tray-navigation.ts
description: Reports this window's inbox count, recent sessions and recording state to the macOS tray.
---

## Derived relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/features/native-integrations/tray-navigation.ts](../../../../../../apps/electron/src/renderer/features/native-integrations/tray-navigation.ts) | [apps/electron/src/renderer/App.tsx](../../../../../../apps/electron/src/renderer/App.tsx) | Invokes supplied callbacks: navigateHome, reportError, runDoctor | typescript |
