---
type: C4 Component
title: Api
status: stable
groma:
  id: api-api
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/api/api.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/api/types.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/api/session-guard.ts
description: Implements the Weixin iLink CGI client for long-poll updates, sends and config.
---
