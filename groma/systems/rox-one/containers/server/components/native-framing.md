---
type: C4 Component
title: Framing
status: stable
groma:
  id: native-framing
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/native/framing.ts
    - scanner: typescript
      file: packages/server-core/src/native/supervisor.ts
    - scanner: typescript
      file: packages/server-core/src/native/client.ts
  technology: Unix socket
description: Encodes and decodes length-prefixed JSON frames on the native Unix socket.
---
