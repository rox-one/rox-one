---
type: C4 Component
title: Index
status: stable
groma:
  id: whatsapp-index
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/whatsapp/index.ts
  technology: Baileys
description: Manages the WhatsApp worker subprocess and translates its events to the adapter interface.
---
