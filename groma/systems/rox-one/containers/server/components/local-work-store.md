---
type: C4 Component
title: Local work store
status: stable
groma:
  id: local-work-store
  parent: server
  code:
    - scanner: typescript
      file: packages/server-core/src/work/local-work-store.ts
description: Stores local work records as atomic, revision-checked JSON files per collection.
---
