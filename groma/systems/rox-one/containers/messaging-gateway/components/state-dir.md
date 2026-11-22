---
type: C4 Component
title: State dir
status: stable
groma:
  id: state-dir
  parent: messaging-gateway
  code:
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/storage/state-dir.ts
    - scanner: typescript
      file: packages/messaging-gateway/src/adapters/wechat/ilink/storage/sync-buf.ts
description: Resolves the on-disk state directory for WeChat account and sync data.
---
