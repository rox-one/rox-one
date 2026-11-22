---
type: C4 Component
title: Browser toolbar
status: stable
groma:
  id: renderer-browser-toolbar
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/browser-toolbar.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/browser-toolbar.tsx
    - scanner: react
      file: apps/electron/src/renderer/App.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/App.tsx
      symbol: App
    - scanner: react
      file: apps/electron/src/renderer/voice-overlay.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/voice-overlay.tsx
      symbol: OverlayApp
    - scanner: react
      file: apps/electron/src/renderer/main.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/main.tsx
    - scanner: react
      file: apps/electron/src/renderer/browser-empty-state.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/browser-empty-state.tsx
    - scanner: react
      file: apps/electron/src/renderer/OnboardingHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/OnboardingHost.tsx
    - scanner: react
      file: apps/electron/src/renderer/bootstrap.ts
    - scanner: typescript
      file: apps/electron/src/renderer/bootstrap.ts
    - scanner: react
      file: apps/electron/src/renderer/perf-dom.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/perf-dom.tsx
    - scanner: react
      file: apps/electron/src/renderer/playground.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/playground.tsx
    - scanner: react
      file: apps/electron/src/renderer/FilePreviewHost.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/FilePreviewHost.tsx
      symbol: FilePreviewHost
    - scanner: typescript
      file: apps/electron/src/renderer/voice-overlay-rox2-surface.ts
    - scanner: typescript
      file: apps/electron/src/renderer/playground-polyfills.ts
description: Runs the standalone React toolbar window for the embedded browser with navigation and menu controls.
---

## Relationships

| Source | Target | Description | Technology |
| --- | --- | --- | --- |
| [apps/electron/src/renderer/main.tsx](../../../../../../apps/electron/src/renderer/main.tsx) | [packages/ui/src/index.ts](../../../../../../packages/ui/src/index.ts) | Renders shared UI | React |
| [apps/electron/src/renderer/main.tsx](../../../../../../apps/electron/src/renderer/main.tsx) | [apps/electron/src/main/index.ts](../../../../../../apps/electron/src/main/index.ts) | Sends session requests | Electron IPC |
