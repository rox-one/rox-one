---
type: C4 Component
title: Protocol
status: stable
groma:
  id: messaging-whatsapp-worker-src-protocol
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-whatsapp-worker/src/protocol.ts
    - scanner: typescript
      file: packages/messaging-whatsapp-worker/src/filter.ts
    - scanner: typescript
      file: packages/messaging-whatsapp-worker/src/upsert.ts
    - scanner: typescript
      file: packages/messaging-whatsapp-worker/src/worker.ts
      symbol: BaileysModule
    - scanner: typescript
      file: packages/messaging-whatsapp-worker/src/media.ts
  technology: NDJSON
description: Defines the NDJSON IPC command and event contract for the WhatsApp worker subprocess.
---
