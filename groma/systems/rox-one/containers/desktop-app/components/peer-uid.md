---
type: C4 Component
title: Peer uid
status: stable
groma:
  id: peer-uid
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/app-control/peer-uid.ts
    - scanner: typescript
      file: apps/electron/src/main/app-control/exec-approvals.ts
    - scanner: typescript
      file: apps/electron/src/main/app-control/auth.ts
    - scanner: typescript
      file: apps/electron/src/main/app-control/protocol.ts
    - scanner: typescript
      file: apps/electron/src/main/app-control/client.ts
    - scanner: typescript
      file: apps/electron/src/main/app-control/index.ts
    - scanner: typescript
      file: apps/electron/src/main/app-control/server.ts
  technology: bun:ffi
description: Verifies the peer UID of app-control sockets, failing closed when credentials are unreadable.
---
