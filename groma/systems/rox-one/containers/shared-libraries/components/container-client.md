---
type: C4 Component
title: Container client
status: stable
groma:
  id: container-client
  parent: shared-libraries
  code:
    - scanner: typescript
      file: packages/rovers-core/src/engines/local/container-client.ts
    - scanner: typescript
      file: packages/rovers-core/src/engines/local/lima.ts
  technology: Docker Engine API
description: Docker Engine API client over a pinned Unix socket with digest-pinned images and ownership labels.
---
