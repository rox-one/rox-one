---
type: C4 Component
title: Preload heavy dep stub
status: stable
groma:
  id: preload-heavy-dep-stub
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/renderer/shims/preload-heavy-dep-stub.ts
      symbol: unavailable
    - scanner: typescript
      file: apps/electron/src/renderer/shims/npm-locks-stub.ts
      symbol: getNpmLock
    - scanner: typescript
      file: apps/electron/src/renderer/shims/glob-stub.ts
    - scanner: typescript
      file: apps/electron/src/renderer/shims/claude-agent-sdk-stub.ts
    - scanner: typescript
      file: apps/electron/src/renderer/shims/node-stub.ts
    - scanner: typescript
      file: apps/electron/src/renderer/shims/bash-parser-stub.ts
      symbol: bashParser
    - scanner: typescript
      file: apps/electron/src/renderer/shims/tar-stub.ts
description: Stubs heavy model and diagram SDKs so the Electron preload bundle stays small.
---
