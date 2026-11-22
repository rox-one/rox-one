---
type: C4 Component
title: Ssh tunnel
status: stable
groma:
  id: ssh-tunnel
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/ssh-tunnel.ts
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/ipc.ts
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/port-allocator.ts
      symbol: findFreePort
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/connection-resolver.ts
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/server-artifact.ts
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/ssh-tunnel-manager.ts
    - scanner: typescript
      file: apps/electron/src/main/ssh-tunnel/server-bootstrap.ts
description: Manages an SSH port-forward tunnel to a remote server with probing and auto-reconnect.
---
