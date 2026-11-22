---
type: C4 Component
title: Index
status: stable
groma:
  id: feed-index
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/shared/src/feed/index.ts
    - scanner: typescript
      file: packages/shared/src/feed/detect.ts
    - scanner: typescript
      file: packages/shared/src/feed/types.ts
    - scanner: typescript
      file: packages/shared/src/feed/agent-items.ts
    - scanner: typescript
      file: packages/shared/src/feed/parse-feed.ts
description: Re-exports feed types, item detection, feed parsing and agent-item helpers.
---
