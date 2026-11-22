---
type: C4 Component
title: Cdn url
status: stable
groma:
  id: cdn-url
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/cdn/cdn-url.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/cdn/pic-decrypt.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/cdn/cdn-upload.ts
      symbol: uploadBufferToCdn
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/cdn/aes-ecb.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/cdn/upload.ts
description: Builds Weixin CDN download and upload URLs for encrypted media transfer.
---
