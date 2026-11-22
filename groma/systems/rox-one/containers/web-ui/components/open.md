---
type: C4 Component
title: Open
status: stable
groma:
  id: open
  parent: web-ui
  code:
    - scanner: typescript
      file: apps/webui/src/shims/open.ts
      symbol: open
    - scanner: typescript
      file: apps/webui/src/shims/ws.ts
    - scanner: typescript
      file: apps/webui/src/shims/fs-promises.ts
    - scanner: typescript
      file: apps/webui/src/shims/node-builtins.ts
    - scanner: typescript
      file: apps/webui/src/shims/electron-log.ts
description: Browser shim for the open package using window.open.
---
