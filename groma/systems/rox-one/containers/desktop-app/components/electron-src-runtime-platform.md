---
type: C4 Component
title: Platform
status: stable
groma:
  id: electron-src-runtime-platform
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/runtime/platform.ts
    - scanner: typescript
      file: apps/electron/src/runtime/platform-headless.ts
description: Thin re-export of server-core runtime platform services and scoped loggers.
---
