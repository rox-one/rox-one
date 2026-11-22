---
type: C4 Component
title: Device diagnostics
status: stable
groma:
  id: preload-device-diagnostics
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/preload/device-diagnostics.ts
      symbol: createDeviceDiagnosticsBridge
    - scanner: typescript
      file: apps/electron/src/preload/native-replica.ts
    - scanner: typescript
      file: apps/electron/src/preload/rox-desktop.ts
    - scanner: typescript
      file: apps/electron/src/preload/browser-toolbar.ts
    - scanner: typescript
      file: apps/electron/src/preload/home-fetch.ts
      symbol: createHomeFetchBridge
    - scanner: typescript
      file: apps/electron/src/preload/oauth-wait.ts
    - scanner: typescript
      file: apps/electron/src/preload/bootstrap.ts
    - scanner: typescript
      file: apps/electron/src/preload/openclaw-host-control.ts
    - scanner: typescript
      file: apps/electron/src/preload/voice-overlay.ts
description: Exposes a minimal preload bridge for reading and cancelling device diagnostics.
---
