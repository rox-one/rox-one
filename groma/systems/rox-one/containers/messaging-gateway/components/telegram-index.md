---
type: C4 Component
title: Index
status: stable
groma:
  id: telegram-index
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/telegram/index.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/telegram/format.ts
  technology: grammY
description: Adapts Telegram chats to the messaging platform interface using grammY polling.
---
