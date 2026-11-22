---
type: C4 Component
title: Index
status: stable
groma:
  id: electron-src-transport-index
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/transport/index.ts
    - scanner: typescript
      file: apps/electron/src/transport/channel-map.ts
      symbol: CHANNEL_MAP
    - scanner: typescript
      file: apps/electron/src/transport/client.ts
    - scanner: typescript
      file: apps/electron/src/transport/build-api.ts
    - scanner: typescript
      file: apps/electron/src/transport/server.ts
    - scanner: typescript
      file: apps/electron/src/transport/project-authority-connection.ts
    - scanner: typescript
      file: apps/electron/src/transport/routed-client.ts
    - scanner: typescript
      file: apps/electron/src/transport/codec.ts
  technology: WebSocket
description: Re-exports the WebSocket RPC server, client and channel map used by the Electron transport.
---
