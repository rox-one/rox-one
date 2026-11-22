---
type: C4 Component
title: Channels
status: stable
groma:
  id: protocol-channels
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/protocol/channels.ts
    - scanner: typescript
      file: packages/shared/src/protocol/events.ts
    - scanner: typescript
      file: packages/shared/src/protocol/routing.ts
    - scanner: typescript
      file: packages/shared/src/protocol/note-tasks.ts
    - scanner: typescript
      file: packages/shared/src/protocol/runtime-trace.ts
    - scanner: typescript
      file: packages/shared/src/protocol/catalog.ts
    - scanner: typescript
      file: packages/shared/src/protocol/capabilities.ts
    - scanner: typescript
      file: packages/shared/src/protocol/index.ts
    - scanner: typescript
      file: packages/shared/src/protocol/native-replica.ts
    - scanner: typescript
      file: packages/shared/src/protocol/version-policy.ts
    - scanner: typescript
      file: packages/shared/src/protocol/native-channels.ts
    - scanner: typescript
      file: packages/shared/src/protocol/types.ts
    - scanner: typescript
      file: packages/shared/src/protocol/bulk-limit.ts
      symbol: BULK_UPDATE_MAX_IDS
    - scanner: typescript
      file: packages/shared/src/protocol/dto.ts
    - scanner: typescript
      file: packages/shared/src/protocol/session-attribution.ts
description: Defines the stable RPC channel-name contract grouped by domain namespace for main, renderer and server communication.
---
