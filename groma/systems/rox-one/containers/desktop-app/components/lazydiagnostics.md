---
type: C4 Component
title: LazyDiagnostics
status: stable
groma:
  id: lazydiagnostics
  parent: desktop-app
  code:
    - scanner: react
      file: apps/electron/src/renderer/components/app-shell/diagnostics/LazyDiagnostics.tsx
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/diagnostics/LazyDiagnostics.tsx
      symbol: LazyDiagnostics
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/diagnostics/diagnostics-model.ts
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/diagnostics/diagnostics-poller.ts
      symbol: createDiagnosticsPoller
    - scanner: typescript
      file: apps/electron/src/renderer/components/app-shell/diagnostics/use-diagnostics.ts
description: Renders tabbed device diagnostics for overview, network, processes, servers, agents and logs.
---
