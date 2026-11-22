---
type: C4 Component
title: Service
status: stable
groma:
  id: main-im-service
  parent: desktop-app
  code:
    - scanner: typescript
      file: apps/electron/src/main/im/service.ts
    - scanner: typescript
      file: apps/electron/src/main/im/handlers.ts
    - scanner: typescript
      file: apps/electron/src/main/im/index.ts
    - scanner: typescript
      file: apps/electron/src/main/im/types.ts
    - scanner: typescript
      file: apps/electron/src/main/im/chat-core-loader.ts
    - scanner: typescript
      file: apps/electron/src/main/im/flags.ts
  technology: '@rox/chat-core'
description: Owns the native chat-core messenger client in main and pushes message, presence and typing events.
---
