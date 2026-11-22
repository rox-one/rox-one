---
type: C4 Component
title: Logger
status: stable
groma:
  id: util-logger
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/util/logger.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/util/random.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/util/redact.ts
description: Writes structured JSON-line logs for the vendored WeChat transport.
---
