---
type: C4 Component
title: Media download
status: stable
groma:
  id: media-download
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/media/media-download.ts
      symbol: downloadMediaFromItem
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/media/silk-transcode.ts
      symbol: silkToWav
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/media/mime.ts
description: Downloads and decrypts inbound Weixin images, voice and video into local media files.
---
