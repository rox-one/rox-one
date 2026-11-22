---
type: C4 Component
title: Inbound
status: stable
groma:
  id: messaging-inbound
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/messaging/inbound.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/messaging/send-media.ts
      symbol: sendWeixinMediaFile
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/messaging/send.ts
description: Normalizes inbound Weixin messages and persists per-user context tokens for replies.
---
