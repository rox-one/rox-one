---
type: C4 Component
title: Protocol
status: stable
groma:
  id: messaging-discord-worker-src-protocol
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-discord-worker/src/protocol.ts
    - scanner: typescript
      file: packages/messaging-discord-worker/src/worker.ts
  technology: NDJSON
description: Defines the NDJSON IPC command and event contract for the Discord worker subprocess.
---
