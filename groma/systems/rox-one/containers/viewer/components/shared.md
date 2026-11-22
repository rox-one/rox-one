---
type: C4 Component
title: Shared
status: stable
groma:
  id: shared
  parent: viewer
  code:
    - scanner: typescript
      file: apps/viewer/functions/s/_shared.ts
    - scanner: typescript
      file: apps/viewer/functions/s/api.ts
  technology: Cloudflare R2
description: Shared helpers for viewer share storage, CORS, validation and rate limiting.
---
