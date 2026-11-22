---
type: C4 Component
title: Worker
status: stable
groma:
  id: browser-intel-worker
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/browser-intel/worker.ts
    - scanner: typescript
      file: apps/electron/src/main/browser-intel/index.ts
  technology: Worker threads, SQLite
description: Worker-thread entry running the Browser Intelligence unfurl pipeline against a SQLite store.
---
