---
type: C4 Component
title: Feed service
status: stable
groma:
  id: feed-service
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/feed/feed-service.ts
    - scanner: typescript
      file: packages/server-core/src/feed/fetcher.ts
    - scanner: typescript
      file: packages/server-core/src/feed/x-adapter.ts
description: Polls configured feed sources and persists fetched items and annotations.
---
